#!/usr/bin/env node
// Kimi K3 runner for globally mapped, adaptively edited nonfiction chapters.
// Unlike the legacy fixed-band runner, this script gives chapters no minimum or
// target length. A whole-book map and binding chapter brief make the selection.
import { access, appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const API_BASE = 'https://api.kimi.com/coding';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--src') args.src = argv[++i];
    else if (arg === '--global-map') args.globalMap = argv[++i];
    else if (arg === '--brief-dir') args.briefDir = argv[++i];
    else if (arg === '--titles') args.titles = argv[++i];
    else if (arg === '--prompt') args.prompt = argv[++i];
    else if (arg === '--out') args.out = argv[++i];
    else if (arg === '--chapters') args.chapters = argv[++i];
    else if (arg === '--parallel') args.parallel = argv[++i];
    else if (arg === '--effort') args.effort = argv[++i];
    else if (arg === '--max-tokens') args.maxTokens = argv[++i];
    else if (arg === '--env-file') args.envFile = argv[++i];
    else if (arg === '--dry-run') args.dryRun = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

async function loadEnv(file) {
  if (!file || !(await exists(file))) return;
  const text = await readFile(file, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(raw.trim());
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
}

const wordCount = text => (text.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu) || []).length;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function loadChapters(text) {
  const chapters = [];
  for (const block of text.split(/^={10,}\s*$/m).map(part => part.trim()).filter(Boolean)) {
    if (!/^\d+\s*\n/.test(block)) continue;
    const lines = block.split('\n');
    const num = Number(lines[0].trim());
    const title = lines[1]?.trim() || `Chapter ${num}`;
    chapters.push({ num, title, text: block, words: wordCount(block) });
  }
  return chapters;
}

async function streamKimi({ key, label, messages, effort, maxTokens }) {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    let response;
    try {
      response = await fetch(`${API_BASE}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          accept: 'text/event-stream',
        },
        body: JSON.stringify({
          model: 'k3',
          max_tokens: maxTokens,
          messages,
          stream: true,
          thinking: { type: 'enabled' },
          reasoning_effort: effort,
        }),
      });
    } catch (error) {
      if (attempt === 6) throw error;
      const wait = Math.min(20 * attempt, 90);
      console.error(`${label}: network failure; retrying in ${wait}s`);
      await sleep(wait * 1000);
      continue;
    }

    if (!response.ok) {
      const detail = await response.text();
      if ((response.status === 429 || response.status >= 500) && attempt < 6) {
        const wait = Math.min(30 * attempt, 150);
        console.error(`${label}: API ${response.status}; retrying in ${wait}s`);
        await sleep(wait * 1000);
        continue;
      }
      throw new Error(`${label}: API ${response.status}: ${detail.slice(0, 300)}`);
    }

    const started = Date.now();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let output = '';
    let stopReason = null;
    let usage = {};

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        for (const line of event.split('\n')) {
          if (!line.startsWith('data:')) continue;
          let parsed;
          try { parsed = JSON.parse(line.slice(5)); } catch { continue; }
          if (parsed.type === 'message_start') usage = { ...(parsed.message?.usage || {}) };
          if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') output += parsed.delta.text;
          if (parsed.type === 'message_delta') {
            stopReason = parsed.delta?.stop_reason || stopReason;
            usage = { ...usage, ...(parsed.usage || {}) };
          }
          if (parsed.type === 'error') throw new Error(`${label}: ${parsed.error?.message || 'stream error'}`);
        }
      }
    }

    const telemetry = {
      label,
      effort,
      secs: Math.round((Date.now() - started) / 1000),
      stop: stopReason,
      words: wordCount(output),
      requested_max_tokens: maxTokens,
      input_miss: usage.input_tokens || 0,
      cache_creation: usage.cache_creation_input_tokens || 0,
      cache_read: usage.cache_read_input_tokens || 0,
      output: usage.output_tokens || 0,
    };
    if (!output.trim()) throw new Error(`${label}: empty output (stop=${stopReason})`);
    return { output, telemetry };
  }
  throw new Error(`${label}: retries exhausted`);
}

async function runPool(items, parallel, worker) {
  const queue = [...items];
  const results = [];
  const runners = Array.from({ length: Math.min(parallel, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      results.push(await worker(item));
    }
  });
  await Promise.all(runners);
  return results.sort((a, b) => a.num - b.num);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const required of ['src', 'globalMap', 'briefDir', 'titles', 'prompt', 'out']) {
    if (!args[required]) throw new Error(`Missing --${required.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`);
  }

  const [source, globalMap, prompt, titlesText] = await Promise.all([
    readFile(args.src, 'utf8'),
    readFile(args.globalMap, 'utf8'),
    readFile(args.prompt, 'utf8'),
    readFile(args.titles, 'utf8'),
  ]);
  const titles = JSON.parse(titlesText);
  const allChapters = loadChapters(source);
  const wanted = args.chapters
    ? new Set(args.chapters.split(',').map(value => Number(value.trim())))
    : new Set(allChapters.map(chapter => chapter.num));
  const chapters = allChapters.filter(chapter => wanted.has(chapter.num));
  if (!chapters.length) throw new Error('No matching chapters');

  const prepared = [];
  for (const chapter of chapters) {
    const briefPath = path.join(args.briefDir, `ch${String(chapter.num).padStart(2, '0')}.md`);
    prepared.push({ ...chapter, briefPath, brief: await readFile(briefPath, 'utf8') });
  }

  console.log(`chapters=${prepared.map(item => item.num).join(',')} globalMapWords=${wordCount(globalMap)} promptWords=${wordCount(prompt)}`);
  for (const item of prepared) console.log(`ch${item.num}: source=${item.words} brief=${wordCount(item.brief)} title=${titles[String(item.num)] || item.title}`);
  if (args.dryRun) return;

  await loadEnv(args.envFile || '.env');
  const key = process.env.KIMI_API_KEY;
  if (!key) throw new Error('KIMI_API_KEY is not set');
  const effort = args.effort || 'high';
  const maxTokens = Number(args.maxTokens || 48000);
  const parallel = Math.max(1, Number(args.parallel || 3));
  await mkdir(args.out, { recursive: true });

  const stablePrefix = `${prompt.trim()}\n\n<global_map>\n${globalMap.trim()}\n</global_map>`;
  await runPool(prepared, parallel, async chapter => {
    const destination = path.join(args.out, `ch${String(chapter.num).padStart(2, '0')}.md`);
    if (await exists(destination)) {
      console.log(`ch${chapter.num}: exists, skipping`);
      return { num: chapter.num, skipped: true };
    }
    const runBrief = [
      '<run_brief>',
      `chapter_id: ${chapter.num}`,
      `required_heading: ## Chapter ${chapter.num}: ${titles[String(chapter.num)] || chapter.title}`,
      '</run_brief>',
    ].join('\n');
    const messages = [{
      role: 'user',
      content: [
        { type: 'text', text: stablePrefix, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: `\n\n<chapter_brief>\n${chapter.brief.trim()}\n</chapter_brief>\n\n${runBrief}\n\n<source_chapter>\n${chapter.text}\n</source_chapter>` },
      ],
    }];
    console.log(`ch${chapter.num}: launch`);
    const { output, telemetry } = await streamKimi({
      key,
      label: `ch${chapter.num}`,
      messages,
      effort,
      maxTokens,
    });
    telemetry.srcWords = chapter.words;
    telemetry.ratio = Number((telemetry.words / chapter.words).toFixed(3));
    telemetry.mapWords = wordCount(globalMap);
    telemetry.briefWords = wordCount(chapter.brief);
    await writeFile(destination, `${output.trim()}\n`);
    await appendFile(path.join(args.out, 'telemetry.jsonl'), `${JSON.stringify(telemetry)}\n`);
    console.log(`ch${chapter.num}: ${telemetry.words}/${chapter.words} words (${(100 * telemetry.ratio).toFixed(1)}%) stop=${telemetry.stop} secs=${telemetry.secs}`);
    return { num: chapter.num, telemetry };
  });
}

main().catch(error => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
