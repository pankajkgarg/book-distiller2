#!/usr/bin/env node
// Chapter-wise parallel Gemini distiller (map step of map-reduce).
// Chapters are ATOMIC: never split. Small contiguous chapters are greedy-packed
// into one call (cap via --pack-cap-tokens). One API call per chunk, all parallel.
// No cache, no conversation, no <end_of_book> protocol — assembly is deterministic.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';
const PRICING = { input: { lo: 2.00, hi: 4.00 }, output: { lo: 12.00, hi: 18.00 }, tierBreak: 200000 };

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--manifest') a.manifest = argv[++i];
    else if (x === '--prompt' || x === '-p') a.prompt = argv[++i];
    else if (x === '--model' || x === '-m') a.model = argv[++i];
    else if (x === '--out-dir' || x === '-o') a.outDir = argv[++i];
    else if (x === '--run-dir') a.runDir = argv[++i];
    else if (x === '--pack-cap-tokens') a.packCap = argv[++i];
    else if (x === '--max-output-tokens') a.maxOutputTokens = argv[++i];
    else if (x === '--book-title') a.bookTitle = argv[++i];
    else if (x === '--total-chapters') a.totalChapters = argv[++i];
    else if (x === '--env-file') a.envFile = argv[++i];
  }
  return a;
}

async function loadEnv(file) {
  const txt = await readFile(file, 'utf8').catch(() => '');
  for (const line of txt.split(/\r?\n/)) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function apiPost(url, body, retries = 3) {
  for (let attempt = 1; ; attempt++) {
    let res, text;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      text = await res.text();
    } catch (e) {
      if (attempt > retries) throw e;
      await sleep(3000 * 2 ** (attempt - 1)); continue;
    }
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
    if (res.ok) return payload;
    const retryable = [408, 429].includes(res.status) || res.status >= 500;
    if (retryable && attempt <= retries) {
      console.error(`  API ${res.status}; retry ${attempt}`);
      await sleep(4000 * 2 ** (attempt - 1)); continue;
    }
    const err = new Error(payload?.error?.message || `${res.status}`); err.payload = payload; throw err;
  }
}

// Greedy pack: chapters atomic, merge contiguous while under cap.
function packChapters(chapters, cap) {
  const chunks = [];
  let cur = [];
  let curTok = 0;
  for (const ch of chapters) {
    if (cur.length && curTok + ch.estTokens > cap) { chunks.push(cur); cur = []; curTok = 0; }
    cur.push(ch); curTok += ch.estTokens;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

function styleContract({ bookTitle, totalChapters, chunk, priorTitles }) {
  const span = chunk.length === 1
    ? `Chapter ${chunk[0].n}: ${chunk[0].title}`
    : `Chapters ${chunk[0].n}-${chunk.at(-1).n} (${chunk.map(c => `${c.n}: ${c.title}`).join('; ')})`;
  return [
    `# CONTEXT OVERRIDES (these replace the Operational Procedure of the base instructions)`,
    ``,
    `You are producing ONE SECTION of an already-established long-form immersive distillation of the book "${bookTitle}" (${totalChapters} chapters total). Other sections are produced separately and concatenated in order. Your section covers ${span}.`,
    ``,
    `- Start DIRECTLY with the heading \`## Chapter ${chunk[0].n}: ${chunk[0].title}\` — no book title line, no preamble, no meta commentary.`,
    chunk.length > 1 ? `- When you reach the next chapter in your span, start it with its own \`## Chapter N: Title\` heading.` : null,
    `- Assume the reader has already read the distillation of earlier chapters${priorTitles.length ? ` (${priorTitles.join('; ')})` : ''}. Do NOT re-introduce the book, the author, or concepts those chapters already established; reference them briefly as an author would ("as we saw with the fireground commanders").`,
    `- Do NOT label output with "Part N", do NOT write <end_of_book>, do NOT add closing remarks about the book as a whole. End cleanly where your last chapter's content ends.`,
    `- Cover ONLY the supplied chapter text below. Distill it fully and deeply per the base instructions (immersive author voice, substantial verbatim blockquotes woven with connective commentary, ' -- ' TTS pauses, bold/italic emphasis).`,
  ].filter(Boolean).join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await loadEnv(args.envFile || '.env');
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY not set');

  const model = args.model || 'gemini-3.1-pro-preview';
  const maxOutputTokens = Number(args.maxOutputTokens || 16000);
  const packCap = Number(args.packCap || 11000);
  const bookTitle = args.bookTitle || 'the book';
  const totalChapters = Number(args.totalChapters || 0) || undefined;

  const manifest = JSON.parse(await readFile(args.manifest, 'utf8'));
  const basePrompt = await readFile(args.prompt, 'utf8');
  const runDir = path.resolve(args.runDir || 'temp/chapterwise_run');
  const outDir = path.resolve(args.outDir || runDir);
  await mkdir(runDir, { recursive: true });
  await mkdir(outDir, { recursive: true });

  const chunks = packChapters(manifest, packCap);
  console.log(`Model -> ${model}`);
  console.log(`Packing -> ${manifest.length} chapters into ${chunks.length} calls (cap ${packCap} tok):`);
  chunks.forEach((c, i) => console.log(`  call ${i + 1}: ch ${c.map(x => x.n).join('+')} (~${c.reduce((s, x) => s + x.estTokens, 0)} tok)`));

  const t0 = Date.now();
  const results = await Promise.all(chunks.map(async (chunk, idx) => {
    const priorTitles = manifest.filter(c => c.n < chunk[0].n).map(c => `Ch${c.n} ${c.title}`);
    const chapterTexts = await Promise.all(chunk.map(async c => `--- BEGIN CHAPTER ${c.n}: ${c.title} ---\n${await readFile(c.file, 'utf8')}\n--- END CHAPTER ${c.n} ---`));
    const user = [
      basePrompt, '',
      styleContract({ bookTitle, totalChapters, chunk, priorTitles }), '',
      '--- CHAPTER TEXT TO DISTILL ---', '',
      chapterTexts.join('\n\n'),
    ].join('\n');

    const tStart = Date.now();
    const res = await apiPost(`${API_ROOT}/models/${model}:generateContent?key=${key}`, {
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature: 0, maxOutputTokens, thinkingConfig: { thinkingBudget: -1, includeThoughts: false } },
    });
    const u = res?.usageMetadata || {};
    const text = (res?.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
    if (!text.trim()) throw new Error(`Empty output for call ${idx + 1} (finishReason=${res?.candidates?.[0]?.finishReason})`);
    const secs = (Date.now() - tStart) / 1000;
    const tier = (u.promptTokenCount || 0) > PRICING.tierBreak ? 'hi' : 'lo';
    const outTok = (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
    const cost = ((u.promptTokenCount || 0) * PRICING.input[tier] + outTok * PRICING.output[tier]) / 1e6;
    await writeFile(path.join(runDir, `chunk_${String(idx + 1).padStart(2, '0')}_ch${chunk.map(c => c.n).join('-')}.md`), text);
    console.log(`call ${idx + 1} (ch ${chunk.map(c => c.n).join('+')}) | in=${u.promptTokenCount} out=${u.candidatesTokenCount} think=${u.thoughtsTokenCount || 0} | $${cost.toFixed(4)} | ${secs.toFixed(0)}s`);
    return {
      chunk: idx + 1, chapters: chunk.map(c => c.n), title: chunk.map(c => c.title).join(' + '),
      promptTokens: u.promptTokenCount || 0, outTokens: u.candidatesTokenCount || 0,
      thoughtTokens: u.thoughtsTokenCount || 0, cost, secs, words: text.split(/\s+/).length,
      srcTokens: chunk.reduce((s, c) => s + c.estTokens, 0), text,
    };
  }));
  const wall = (Date.now() - t0) / 1000;

  const assembled = results.map(r => r.text.trim()).join('\n\n') + '\n';
  const summaryOut = path.join(outDir, 'summary-chapterwise.md');
  await writeFile(summaryOut, assembled);

  const tot = results.reduce((a, r) => ({
    cost: a.cost + r.cost, in: a.in + r.promptTokens, out: a.out + r.outTokens,
    think: a.think + r.thoughtTokens, words: a.words + r.words, src: a.src + r.srcTokens,
  }), { cost: 0, in: 0, out: 0, think: 0, words: 0, src: 0 });

  const telemetry = {
    model, calls: results.map(({ text, ...r }) => r), wallSeconds: wall,
    totals: { ...tot, compactionPct: 100 * tot.out / tot.src },
  };
  await writeFile(path.join(outDir, 'telemetry-chapterwise.json'), JSON.stringify(telemetry, null, 2));
  console.log(`\nAssembled -> ${summaryOut}`);
  console.log(`TOTAL: ${results.length} calls in ${wall.toFixed(0)}s wall | in=${tot.in} out=${tot.out} think=${tot.think} | $${tot.cost.toFixed(4)} | ${tot.words} words | compaction=${(100 * tot.out / tot.src).toFixed(1)}%`);
}

main().catch(e => { console.error(`Error: ${e.message}`); if (e.payload) console.error(JSON.stringify(e.payload).slice(0, 600)); process.exit(1); });
