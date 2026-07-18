#!/usr/bin/env node
// Direct Gemini API book distiller with EXPLICIT context caching + thinking.
// - Caches the book + system prompt once (guaranteed cachedContentTokenCount each turn).
// - Multi-turn immersive distillation loop; stops at <end_of_book> or --max-turns.
// - Per-turn telemetry: input/cached/uncached/output/thinking tokens, cache-hit %, $ cost, compaction %.
// - Resumable: state.json + part_NNN.md persisted per run; continue with --resume <dir>.
// Uses REST (no @google/genai npm dep). Key read from .env (never printed).
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';

const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';

// Gemini 3.1 Pro Preview pricing ($/1M tokens). Tiered by total prompt size.
const PRICING = {
  input:      { lo: 2.00, hi: 4.00 },   // uncached input
  cachedRead: { lo: 0.20, hi: 0.40 },   // cached-content read
  output:     { lo: 12.00, hi: 18.00 }, // candidates + thoughts billed as output
  storagePerHr: 4.50,                   // cache storage $/1M tokens/hour
  tierBreak: 200000,
};

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--input' || x === '-i') a.input = argv[++i];
    else if (x === '--prompt' || x === '-p') a.prompt = argv[++i];
    else if (x === '--model' || x === '-m') a.model = argv[++i];
    else if (x === '--out-dir' || x === '-o') a.outDir = argv[++i];
    else if (x === '--run-dir') a.runDir = argv[++i];
    else if (x === '--resume') a.resume = argv[++i];
    else if (x === '--max-turns') a.maxTurns = argv[++i];
    else if (x === '--max-output-tokens') a.maxOutputTokens = argv[++i];
    else if (x === '--ttl') a.ttl = argv[++i];
    else if (x === '--continue-prompt') a.continuePrompt = argv[++i];
    else if (x === '--begin-prompt') a.beginPrompt = argv[++i];
    else if (x === '--thinking-budget') a.thinkingBudget = argv[++i];
    else if (x === '--env-file') a.envFile = argv[++i];
    else if (x === '--source-tokens') a.sourceTokens = argv[++i];
    else a._.push(x);
  }
  return a;
}

async function exists(p) { try { await access(p); return true; } catch { return false; } }

async function loadEnv(file) {
  if (!file || !(await exists(file))) return;
  const txt = await readFile(file, 'utf8');
  for (const line of txt.split(/\r?\n/)) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const tier = promptTok => (promptTok > PRICING.tierBreak ? 'hi' : 'lo');

function costForTurn(u) {
  const t = tier(u.promptTokenCount || 0);
  const cached = u.cachedContentTokenCount || 0;
  const uncached = Math.max(0, (u.promptTokenCount || 0) - cached);
  const out = (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
  return (
    cached * PRICING.cachedRead[t] +
    uncached * PRICING.input[t] +
    out * PRICING.output[t]
  ) / 1e6;
}

async function apiPost(url, body, { retries = 4 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    let res, text;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      text = await res.text();
    } catch (e) {
      lastErr = e;
      if (attempt <= retries) { await sleep(Math.min(60000, 2000 * 2 ** (attempt - 1))); continue; }
      throw e;
    }
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
    if (res.ok) return payload;
    const status = res.status;
    const msg = payload?.error?.message || payload?.raw || `${status}`;
    const err = new Error(msg); err.status = status; err.payload = payload;
    const retryable = status === 429 || status === 408 || (status >= 500 && status < 600);
    lastErr = err;
    if (retryable && attempt <= retries) {
      console.error(`  API ${status} (attempt ${attempt}); retrying: ${msg.slice(0, 160)}`);
      await sleep(Math.min(60000, 3000 * 2 ** (attempt - 1)));
      continue;
    }
    throw err;
  }
  throw lastErr;
}

async function createCache({ key, model, bookText, systemPrompt, ttl }) {
  const url = `${API_ROOT}/cachedContents?key=${key}`;
  const body = {
    model: `models/${model}`,
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: bookText }] }],
    ttl,
  };
  const res = await apiPost(url, body);
  return { name: res.name, cachedTokens: res?.usageMetadata?.totalTokenCount || 0, expireTime: res.expireTime };
}

async function generate({ key, model, cacheName, contents, maxOutputTokens, thinkingBudget }) {
  const url = `${API_ROOT}/models/${model}:generateContent?key=${key}`;
  const genConfig = { temperature: 0, maxOutputTokens };
  const withThinking = thinkingBudget !== 'off';
  if (withThinking) genConfig.thinkingConfig = { thinkingBudget: Number(thinkingBudget), includeThoughts: false };
  const body = { cachedContent: cacheName, contents, generationConfig: genConfig };
  try {
    return await apiPost(url, body);
  } catch (e) {
    // Fallback if this model rejects thinkingConfig shape: retry without it (Pro still thinks by default).
    if (withThinking && e.status === 400 && /think/i.test(e.message)) {
      console.error('  thinkingConfig rejected; retrying with default thinking.');
      delete body.generationConfig.thinkingConfig;
      return await apiPost(url, body);
    }
    throw e;
  }
}

function extractText(res) {
  const parts = res?.candidates?.[0]?.content?.parts || [];
  return parts.filter(p => !p.thought).map(p => p.text || '').join('');
}

function pct(n, d) { return d > 0 ? (100 * n / d) : 0; }

async function loadState(runDir) {
  const f = path.join(runDir, 'state.json');
  return (await exists(f)) ? JSON.parse(await readFile(f, 'utf8')) : null;
}
async function saveState(runDir, state) {
  await writeFile(path.join(runDir, 'state.json'), JSON.stringify(state, null, 2));
}

function fmt(n) { return Number(n).toLocaleString('en-US'); }

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await loadEnv(args.envFile || '.env');
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY not set (add it to .env or pass --env-file).');

  const model = args.model || 'gemini-3.1-pro-preview';
  const maxOutputTokens = Number(args.maxOutputTokens || 8192);
  const ttl = args.ttl || '3600s';
  const thinkingBudget = args.thinkingBudget ?? '-1'; // -1 = dynamic; 'off' disables
  const continuePrompt = args.continuePrompt || 'Next';
  const beginPrompt = args.beginPrompt ||
    'Begin now. Produce the first part starting from the very beginning of the book, following the system instructions exactly.';
  const maxTurns = Number(args.maxTurns || 40);

  const runDir = path.resolve(args.resume || args.runDir || 'temp/sources_of_power/gemini_run');
  await mkdir(runDir, { recursive: true });

  let state = args.resume ? await loadState(runDir) : null;
  let sourceTokens = Number(args.sourceTokens || state?.sourceTokens || 0);

  // First-time setup: read book + prompt, create cache.
  if (!state) {
    const inputPath = path.resolve(args.input);
    const promptPath = path.resolve(args.prompt);
    const bookText = await readFile(inputPath, 'utf8');
    const systemPrompt = await readFile(promptPath, 'utf8');
    if (!sourceTokens) sourceTokens = Math.ceil(Buffer.byteLength(bookText, 'utf8') / 4);
    console.log(`Model -> ${model}`);
    console.log(`Book -> ${inputPath} (${fmt(bookText.length)} chars, ~${fmt(sourceTokens)} tok est)`);
    console.log(`Creating context cache (ttl=${ttl}) ...`);
    const cache = await createCache({ key, model, bookText, systemPrompt, ttl });
    console.log(`Cache -> ${cache.name}  cachedTokens=${fmt(cache.cachedTokens)}  expires=${cache.expireTime}`);
    state = {
      model, inputPath, promptPath, sourceTokens,
      cacheName: cache.name, cacheTokens: cache.cachedTokens, cacheExpireTime: cache.expireTime,
      cacheCreateCost: (cache.cachedTokens * PRICING.input.lo) / 1e6,
      history: [{ role: 'user', parts: [{ text: beginPrompt }] }],
      turns: [], startedAt: new Date().toISOString(),
    };
    await saveState(runDir, state);
  } else {
    console.log(`Resuming ${runDir} -> ${state.turns.length} turns done, cache ${state.cacheName}`);
    // Re-create cache if expired.
    if (state.cacheExpireTime && Date.parse(state.cacheExpireTime) < Date.now() + 30000) {
      console.log('Cache expired; re-creating...');
      const bookText = await readFile(state.inputPath, 'utf8');
      const systemPrompt = await readFile(state.promptPath, 'utf8');
      const cache = await createCache({ key, model: state.model, bookText, systemPrompt, ttl });
      state.cacheName = cache.name; state.cacheTokens = cache.cachedTokens; state.cacheExpireTime = cache.expireTime;
      state.cacheCreateCost = (state.cacheCreateCost || 0) + (cache.cachedTokens * PRICING.input.lo) / 1e6;
      await saveState(runDir, state);
    }
  }

  const startTurn = state.turns.length + 1;
  let reachedEnd = state.turns.some(t => t.reachedEnd);
  if (reachedEnd) { console.log('Already reached <end_of_book>.'); }

  // Telemetry header
  const cum = () => state.turns.reduce((acc, t) => ({
    in: acc.in + t.promptTokenCount, cached: acc.cached + t.cachedContentTokenCount,
    out: acc.out + t.candidatesTokenCount, think: acc.think + t.thoughtsTokenCount,
    cost: acc.cost + t.cost, outChars: acc.outChars + t.outChars,
  }), { in: 0, cached: 0, out: 0, think: 0, cost: 0, outChars: 0 });

  for (let turn = startTurn; turn <= maxTurns && !reachedEnd; turn++) {
    const t0 = Date.now();
    const res = await generate({
      key, model: state.model, cacheName: state.cacheName,
      contents: state.history, maxOutputTokens, thinkingBudget,
    });
    const u = res?.usageMetadata || {};
    const text = extractText(res);
    if (!text.trim()) {
      const fr = res?.candidates?.[0]?.finishReason;
      throw new Error(`Empty output on turn ${turn} (finishReason=${fr}). Raw usage: ${JSON.stringify(u)}`);
    }
    reachedEnd = text.includes('<end_of_book>');
    const cost = costForTurn(u);
    const cachedPct = pct(u.cachedContentTokenCount || 0, u.promptTokenCount || 0);
    const outTok = (u.candidatesTokenCount || 0);

    // persist part + history
    await writeFile(path.join(runDir, `part_${String(turn).padStart(3, '0')}.md`), text);
    state.history.push({ role: 'model', parts: [{ text }] });
    if (!reachedEnd) state.history.push({ role: 'user', parts: [{ text: continuePrompt }] });

    const rec = {
      turn,
      promptTokenCount: u.promptTokenCount || 0,
      cachedContentTokenCount: u.cachedContentTokenCount || 0,
      candidatesTokenCount: outTok,
      thoughtsTokenCount: u.thoughtsTokenCount || 0,
      totalTokenCount: u.totalTokenCount || 0,
      cost, cachedPct, outChars: text.length, reachedEnd, secs: (Date.now() - t0) / 1000,
    };
    state.turns.push(rec);
    await saveState(runDir, state);

    const c = cum();
    const compaction = pct(c.out, state.sourceTokens); // cumulative distilled/source
    console.log(
      `T${String(turn).padStart(2)} | in=${fmt(rec.promptTokenCount)} cached=${fmt(rec.cachedContentTokenCount)} (${cachedPct.toFixed(1)}%) ` +
      `out=${fmt(outTok)} think=${fmt(rec.thoughtsTokenCount)} | $${cost.toFixed(4)} (cum $${(c.cost + (state.cacheCreateCost||0)).toFixed(3)}) ` +
      `| distilled=${fmt(c.out)}/${fmt(state.sourceTokens)}tok=${compaction.toFixed(1)}% | ${rec.secs.toFixed(0)}s ${reachedEnd ? 'END' : ''}`
    );
  }

  // Assemble summary
  const parts = [];
  for (let i = 1; i <= state.turns.length; i++) {
    const f = path.join(runDir, `part_${String(i).padStart(3, '0')}.md`);
    if (await exists(f)) parts.push((await readFile(f, 'utf8')).trim());
  }
  const outDir = path.resolve(args.outDir || 'temp/sources_of_power');
  await mkdir(outDir, { recursive: true });
  const summaryOut = path.join(outDir, 'Sources of Power - summary - gemini-3.1-pro.md');
  await writeFile(summaryOut, parts.join('\n\n') + '\n');

  // Storage cost estimate (wall-clock hours the cache existed)
  const hours = Math.max(0, (Date.now() - Date.parse(state.startedAt)) / 3.6e6);
  const storageCost = (state.cacheTokens * PRICING.storagePerHr * Math.max(hours, 1/60)) / 1e6;
  const c = cum();
  const grand = c.cost + (state.cacheCreateCost || 0) + storageCost;

  // Telemetry report
  const lines = [
    '# Sources of Power — Gemini 3.1 Pro distillation telemetry', '',
    `Model: \`${state.model}\` · cache: \`${state.cacheName}\` · thinking: ${thinkingBudget === 'off' ? 'off' : 'on'}`,
    `Source: ~${fmt(state.sourceTokens)} tokens · turns: ${state.turns.length} · reachedEnd: ${reachedEnd}`,
    `Cache create (one-time): $${(state.cacheCreateCost||0).toFixed(4)} · storage est: $${storageCost.toFixed(4)}`,
    `Per-turn generation cost: $${c.cost.toFixed(4)} · **GRAND TOTAL ~$${grand.toFixed(4)}**`,
    `Cumulative distilled output: ${fmt(c.out)} tokens = ${pct(c.out, state.sourceTokens).toFixed(1)}% of source (compaction)`,
    `Overall cache-hit rate: ${pct(c.cached, c.in).toFixed(1)}% of input tokens served from cache`, '',
    '| Turn | Prompt in | Cached | Cache% | Out | Think | $ turn | $ cum | Distilled/Source | s |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  let cc = 0, cout = 0;
  for (const t of state.turns) {
    cc += t.cost; cout += t.candidatesTokenCount;
    lines.push(`| ${t.turn} | ${fmt(t.promptTokenCount)} | ${fmt(t.cachedContentTokenCount)} | ${t.cachedPct.toFixed(1)}% | ${fmt(t.candidatesTokenCount)} | ${fmt(t.thoughtsTokenCount)} | $${t.cost.toFixed(4)} | $${(cc+(state.cacheCreateCost||0)).toFixed(3)} | ${pct(cout, state.sourceTokens).toFixed(1)}% | ${t.secs.toFixed(0)} |`);
  }
  const telemetryOut = path.join(outDir, 'Sources of Power - telemetry - gemini-3.1-pro.md');
  await writeFile(telemetryOut, lines.join('\n') + '\n');

  console.log(`\nSummary -> ${summaryOut}`);
  console.log(`Telemetry -> ${telemetryOut}`);
  console.log(`Turns=${state.turns.length} reachedEnd=${reachedEnd} GRAND TOTAL ~$${grand.toFixed(4)} (incl cache create $${(state.cacheCreateCost||0).toFixed(4)} + storage $${storageCost.toFixed(4)})`);
  if (!reachedEnd) console.log(`Not finished. Continue: node scripts/gemini-distill.mjs --resume ${runDir} --max-turns <N>`);
}

main().catch(e => { console.error(`Error: ${e.message}`); if (e.payload) console.error(JSON.stringify(e.payload).slice(0, 800)); process.exit(1); });
