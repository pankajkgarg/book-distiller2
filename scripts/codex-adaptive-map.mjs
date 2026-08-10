#!/usr/bin/env node
// Runs the whole-book adaptive mapper through Codex and preserves auditable
// token/cost telemetry. Raw JSONL is retained so estimates can be recomputed
// later if provider prices change.

import { createWriteStream } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { finished } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

export const DEFAULT_PRICING = Object.freeze({
  currency: 'USD',
  unit_tokens: 1_000_000,
  uncached_input_per_unit: 5,
  cached_input_per_unit: 0.5,
  cache_write_multiplier: 1.25,
  output_per_unit: 30,
  long_context_threshold_tokens: 272_000,
  long_context_input_multiplier: 2,
  long_context_output_multiplier: 1.5,
  source: 'https://developers.openai.com/api/docs/models/gpt-5.6-sol',
  checked_at: '2026-08-10',
});

function number(value, fallback) {
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid non-negative number: ${value}`);
  return parsed;
}

function valueAfter(args, name, fallback = null) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (index === args.length - 1 || args[index + 1].startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return args[index + 1];
}

function usageFromEvent(event) {
  const usage = event?.usage || {};
  return {
    input_tokens: number(usage.input_tokens, 0),
    cached_input_tokens: number(usage.cached_input_tokens, 0),
    cache_write_input_tokens: number(usage.cache_write_input_tokens, 0),
    output_tokens: number(usage.output_tokens, 0),
    reasoning_output_tokens: number(usage.reasoning_output_tokens, 0),
  };
}

export function parseCodexUsageJsonl(text) {
  const turns = [];
  let thread_id = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim().startsWith('{')) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === 'thread.started' && event.thread_id) thread_id = event.thread_id;
    if (event.type === 'turn.completed' && event.usage) turns.push(usageFromEvent(event));
  }
  return { thread_id, turns };
}

function addUsage(total, usage) {
  for (const key of Object.keys(total)) total[key] += usage[key] || 0;
  return total;
}

export function calculateCodexCost(turns, pricing = DEFAULT_PRICING) {
  const totals = {
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_write_input_tokens: 0,
    uncached_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
  };
  const pricedTurns = turns.map((usage, index) => {
    addUsage(totals, {
      input_tokens: usage.input_tokens,
      cached_input_tokens: usage.cached_input_tokens,
      cache_write_input_tokens: usage.cache_write_input_tokens,
      uncached_input_tokens: 0,
      output_tokens: usage.output_tokens,
      reasoning_output_tokens: usage.reasoning_output_tokens,
    });
    const uncached = Math.max(
      0,
      usage.input_tokens - usage.cached_input_tokens - usage.cache_write_input_tokens,
    );
    totals.uncached_input_tokens += uncached;
    const isLongContext = usage.input_tokens > pricing.long_context_threshold_tokens;
    const inputMultiplier = isLongContext ? pricing.long_context_input_multiplier : 1;
    const outputMultiplier = isLongContext ? pricing.long_context_output_multiplier : 1;
    const uncachedCost = uncached * pricing.uncached_input_per_unit * inputMultiplier / pricing.unit_tokens;
    const cachedCost = usage.cached_input_tokens * pricing.cached_input_per_unit * inputMultiplier / pricing.unit_tokens;
    const cacheWriteCost = usage.cache_write_input_tokens
      * pricing.uncached_input_per_unit
      * pricing.cache_write_multiplier
      * inputMultiplier
      / pricing.unit_tokens;
    const outputCost = usage.output_tokens * pricing.output_per_unit * outputMultiplier / pricing.unit_tokens;
    return {
      turn: index + 1,
      ...usage,
      uncached_input_tokens: uncached,
      long_context_pricing: isLongContext,
      api_equivalent_usd: uncachedCost + cachedCost + cacheWriteCost + outputCost,
    };
  });

  return {
    totals,
    turns: pricedTurns,
    api_equivalent_usd: pricedTurns.reduce((sum, turn) => sum + turn.api_equivalent_usd, 0),
  };
}

function markdownReport(report) {
  const money = value => value == null ? 'unknown' : `$${value.toFixed(4)}`;
  const lines = [
    '# Codex map usage',
    '',
    `- Model: \`${report.model}\``,
    `- Billing mode: ${report.billing_mode}`,
    `- Status: ${report.status}`,
    `- Turns: ${report.turn_count}`,
    `- Input tokens: ${report.usage.input_tokens}`,
    `- Cached input tokens: ${report.usage.cached_input_tokens}`,
    `- Cache-write input tokens: ${report.usage.cache_write_input_tokens}`,
    `- Uncached input tokens: ${report.usage.uncached_input_tokens}`,
    `- Output tokens: ${report.usage.output_tokens}`,
    `- Reasoning output tokens: ${report.usage.reasoning_output_tokens}`,
    `- API-equivalent cost: ${money(report.api_equivalent_usd)}`,
    `- Actual incremental cost: ${money(report.actual_incremental_cost_usd)}`,
    `- Elapsed seconds: ${report.elapsed_seconds}`,
    `- Pricing checked: ${report.pricing.checked_at}`,
    `- Pricing source: ${report.pricing.source}`,
    '',
    'Reasoning tokens are reported separately for observability but are already included in output-token billing. Raw Codex JSONL is retained beside this report for recalculation.',
    '',
    '| Turn | Input | Cached | Cache write | Uncached | Output | Reasoning | Long context | API equivalent |',
    '|---:|---:|---:|---:|---:|---:|---:|:---:|---:|',
  ];
  for (const turn of report.turns) {
    lines.push(`| ${turn.turn} | ${turn.input_tokens} | ${turn.cached_input_tokens} | ${turn.cache_write_input_tokens} | ${turn.uncached_input_tokens} | ${turn.output_tokens} | ${turn.reasoning_output_tokens} | ${turn.long_context_pricing ? 'yes' : 'no'} | ${money(turn.api_equivalent_usd)} |`);
  }
  return `${lines.join('\n')}\n`;
}

function chapterNumbers(source) {
  const numbers = [];
  for (const block of source.split(/^={40}\s*$/m)) {
    const first = block.split(/\r?\n/).map(line => line.trim()).find(Boolean);
    if (/^\d+$/.test(first || '')) numbers.push(Number(first));
  }
  return [...new Set(numbers)].sort((a, b) => a - b);
}

function ensureInsideWorkspace(target, workspace) {
  const rel = relative(workspace, target);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Output directory must be a child of the current workspace: ${target}`);
  }
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function runCodex({ codexBin, args, input, eventsPath }) {
  await mkdir(dirname(eventsPath), { recursive: true });
  const stream = createWriteStream(eventsPath, { flags: 'w' });
  const child = spawn(codexBin, args, { stdio: ['pipe', 'pipe', 'inherit'] });
  child.stdout.pipe(stream);
  const streamDone = finished(stream);
  child.stdin.on('error', () => {});
  child.stdin.end(input);
  const exitCode = await new Promise((resolveExit, reject) => {
    child.on('error', reject);
    child.on('close', resolveExit);
  });
  await streamDone;
  return exitCode;
}

function pricingFromArgs(args) {
  return {
    ...DEFAULT_PRICING,
    uncached_input_per_unit: number(valueAfter(args, '--input-price'), DEFAULT_PRICING.uncached_input_per_unit),
    cached_input_per_unit: number(valueAfter(args, '--cached-input-price'), DEFAULT_PRICING.cached_input_per_unit),
    output_per_unit: number(valueAfter(args, '--output-price'), DEFAULT_PRICING.output_per_unit),
    checked_at: valueAfter(args, '--pricing-date', DEFAULT_PRICING.checked_at),
    source: valueAfter(args, '--pricing-source', DEFAULT_PRICING.source),
  };
}

async function writeUsage({ eventsPath, usageJsonPath, usageMarkdownPath, model, billingMode, pricing, startedAt, finishedAt, exitCode }) {
  const parsed = parseCodexUsageJsonl(await readFile(eventsPath, 'utf8'));
  const cost = calculateCodexCost(parsed.turns, pricing);
  const apiCost = cost.api_equivalent_usd;
  const report = {
    schema_version: 1,
    model,
    billing_mode: billingMode,
    thread_id: parsed.thread_id,
    status: exitCode === 0 ? 'completed' : 'failed',
    exit_code: exitCode,
    started_at: startedAt,
    finished_at: finishedAt,
    elapsed_seconds: Math.round((Date.parse(finishedAt) - Date.parse(startedAt)) / 1000),
    turn_count: parsed.turns.length,
    usage: cost.totals,
    turns: cost.turns,
    pricing,
    api_equivalent_usd: apiCost,
    actual_incremental_cost_usd: billingMode === 'subscription' ? 0 : billingMode === 'api' ? apiCost : null,
  };
  await writeFile(usageJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(usageMarkdownPath, markdownReport(report));
  return report;
}

async function main() {
  const args = process.argv.slice(2);
  const workspace = resolve(process.cwd());
  const model = valueAfter(args, '--model', 'gpt-5.6-sol');
  const effort = valueAfter(args, '--effort', 'medium');
  const billingMode = valueAfter(args, '--billing-mode', 'subscription');
  if (!['subscription', 'api', 'unknown'].includes(billingMode)) {
    throw new Error('--billing-mode must be subscription, api, or unknown');
  }
  const outDir = resolve(valueAfter(args, '--out', ''));
  if (!valueAfter(args, '--out')) throw new Error('Required: --out <directory>');
  ensureInsideWorkspace(outDir, workspace);
  await mkdir(resolve(outDir, 'chapter_briefs'), { recursive: true });

  const eventsPath = resolve(valueAfter(args, '--events', resolve(outDir, 'codex-map-events.jsonl')));
  const usageJsonPath = resolve(outDir, 'codex-map-usage.json');
  const usageMarkdownPath = resolve(outDir, 'codex-map-usage.md');
  const pricing = pricingFromArgs(args);
  const existingEvents = args.includes('--calculate-only');
  if (existingEvents) {
    if (!(await exists(eventsPath))) throw new Error(`Events file not found: ${eventsPath}`);
    const now = new Date().toISOString();
    const report = await writeUsage({
      eventsPath,
      usageJsonPath,
      usageMarkdownPath,
      model,
      billingMode,
      pricing,
      startedAt: now,
      finishedAt: now,
      exitCode: 0,
    });
    console.log(`usage -> ${usageJsonPath} (${report.turn_count} turns, $${report.api_equivalent_usd.toFixed(4)} API-equivalent)`);
    return;
  }

  const srcPath = valueAfter(args, '--src');
  const promptPath = valueAfter(args, '--prompt');
  if (!srcPath || !promptPath) throw new Error('Required: --src <book.txt> --prompt <map-prompt.md> --out <directory>');
  const [source, mapperPrompt] = await Promise.all([
    readFile(resolve(srcPath), 'utf8'),
    readFile(resolve(promptPath), 'utf8'),
  ]);
  const chapters = chapterNumbers(source);
  if (!chapters.length) throw new Error('No logical chapters found; verify forty-character separators and bare chapter-number lines');

  const instruction = [
    mapperPrompt.trim(),
    '',
    '## Run contract',
    '',
    'Read the complete source below before deciding. Write the requested artifacts only inside the current working directory:',
    '- `global_map.md`',
    '- `titles.json`',
    `- one brief in \`chapter_briefs/chNN.md\` for each of these logical chapters: ${chapters.join(', ')}`,
    '',
    'Do not merely describe the files in your final response: create and verify them. Do not write reader-facing distilled prose.',
    '',
    '--- COMPLETE CLEANED SOURCE ---',
    source.trim(),
    '',
  ].join('\n');

  const lastMessagePath = resolve(outDir, 'codex-map-last-message.md');
  const codexArgs = [
    '--ask-for-approval', 'never',
    'exec',
    '-C', outDir,
    '--skip-git-repo-check',
    '--ignore-rules',
    '--ignore-user-config',
    '-m', model,
    '-s', 'workspace-write',
    '-c', `model_reasoning_effort="${effort}"`,
    '--json',
    '-o', lastMessagePath,
    '-',
  ];
  if (args.includes('--dry-run')) {
    console.log(JSON.stringify({ model, effort, billingMode, chapters, outDir, eventsPath, prompt_chars: instruction.length }, null, 2));
    return;
  }

  const startedAt = new Date().toISOString();
  const exitCode = await runCodex({
    codexBin: valueAfter(args, '--codex-bin', 'codex'),
    args: codexArgs,
    input: instruction,
    eventsPath,
  });
  const finishedAt = new Date().toISOString();
  const report = await writeUsage({
    eventsPath,
    usageJsonPath,
    usageMarkdownPath,
    model,
    billingMode,
    pricing,
    startedAt,
    finishedAt,
    exitCode,
  });
  console.log(`usage -> ${usageJsonPath} (${report.turn_count} turns, $${report.api_equivalent_usd.toFixed(4)} API-equivalent)`);
  if (exitCode !== 0) throw new Error(`Codex exited with ${exitCode}; raw events and partial usage were preserved`);
  if (!report.turn_count) throw new Error('Codex completed without a turn.completed usage record');

  for (const path of [resolve(outDir, 'global_map.md'), resolve(outDir, 'titles.json')]) {
    if (!(await exists(path))) throw new Error(`Missing mapper artifact: ${path}`);
  }
  JSON.parse(await readFile(resolve(outDir, 'titles.json'), 'utf8'));
  for (const chapter of chapters) {
    const brief = resolve(outDir, 'chapter_briefs', `ch${String(chapter).padStart(2, '0')}.md`);
    if (!(await exists(brief))) throw new Error(`Missing chapter brief: ${brief}`);
  }
  console.log(`mapped ${chapters.length} chapters -> ${outDir}`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
