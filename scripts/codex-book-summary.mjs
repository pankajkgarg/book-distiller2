#!/usr/bin/env node
import { createWriteStream } from 'node:fs';
import { access, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { DEFAULT_PROMPT } from '../core.js';

const PDFJS_VERSION = '4.10.38';
const FFLATE_VERSION = '0.8.2';
const PROVIDER_CODEX = 'codex';
const PROVIDER_OPENROUTER = 'openrouter';
const PROVIDER_DEEPSEEK = 'deepseek';
const OPENROUTER_DEFAULT_MODEL = 'deepseek/deepseek-v3.2';
const OPENROUTER_DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_DEFAULT_CLAUDE_CACHE_TTL = '5m';
const DEEPSEEK_DEFAULT_MODEL = 'deepseek-chat';
const DEEPSEEK_DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 15000;

function printHelp() {
  console.log(`
Usage:
  book-distill --input <book.pdf|book.epub|book.txt|book.md> [--prompt <prompt.md>]
  node scripts/codex-book-summary.mjs --input <book.pdf|book.epub|book.txt|book.md> [--prompt <prompt.md>]

Options:
  -i, --input <file>          Source book file. First positional arg also works.
  -p, --prompt <file>         Summarizer prompt. Defaults to temp/summarizer_prompt.md when present,
                              otherwise the built-in distillation prompt (same as the browser app).
      --provider <provider>   codex, openrouter, or deepseek. Default: codex
  -m, --model <model>         Model to use. Default: gpt-5.5 for codex, ${OPENROUTER_DEFAULT_MODEL} for openrouter, ${DEEPSEEK_DEFAULT_MODEL} for deepseek
      --language <language>   Target summary language. Non-English adds a short prompt suffix before the source. Default: English
      --lang-code <code>      Filename language suffix. Default: inferred from --language
  -o, --out-dir <dir>         Where extracted/summary markdown files are written. Default: source file directory.
      --run-root <dir>        Where chunk/event run folders are written. Default: temp/codex_runs
      --cache-dir <dir>       Where PDF.js/fflate extractor modules are cached. Default: temp/codex_book_summary_cache
      --codex-bin <cmd>       Codex executable. Default: codex
      --openrouter-api-key-env <name>
                              Env var for OpenRouter API key. Default: OPENROUTER_API_KEY
      --openrouter-base-url <url>
                              OpenRouter API base URL. Default: ${OPENROUTER_DEFAULT_BASE_URL}
      --openrouter-session-id <id>
                              Stable routing key (max 256 chars) used to keep prompt-cache calls on one provider endpoint.
      --openrouter-cache-ttl <ttl>
                              Explicit prompt cache TTL for OpenRouter: 1h, 5m, or none.
                              Default: 5m for Claude and Gemini; Grok caching is automatic.
      --deepseek-api-key-env <name>
                              Env var for DeepSeek API key. Default: DEEPSEEK_API_KEY
      --deepseek-base-url <url>
                              DeepSeek API base URL. Default: ${DEEPSEEK_DEFAULT_BASE_URL}
      --env-file <file>       Load API keys from a dotenv-style file without printing them.
      --list-openrouter-models [query]
                              List OpenRouter models, optionally filtered by query, then exit.
      --temperature <n>       Optional chat-completions temperature.
      --reasoning-effort <n>  Reasoning effort: max, xhigh, high, medium, low, minimal, or none.
      --max-output-tokens <n> Optional chat-completions max output tokens. Default: omit max_tokens.
      --no-max-output-tokens  Do not send max_tokens to chat-completions providers; also overrides resumed capped runs.
      --max-parts <n>         Max continuation chunks. Default: 20
      --continue-prompt <s>   Prompt for continuation turns. Default: continue
      --retries <n>           Retries per chat-completions call for transient failures. Default: ${DEFAULT_RETRIES}
      --retry-delay-ms <n>    Initial retry delay in milliseconds. Default: ${DEFAULT_RETRY_DELAY_MS}
      --resume-run <dir>      Resume an existing run dir from the last completed part.
      --workdir <dir>         Temporary Codex working directory. Default: OS temp dir
      --extract-only          Only extract source to Markdown; do not run Codex.
      --help                  Show this help.

Examples:
  node scripts/codex-book-summary.mjs -i temp/book.pdf -p temp/summarizer_prompt.md
  node scripts/codex-book-summary.mjs temp/book.epub --model gpt-5.5 --language Hindi --lang-code hi
  node scripts/codex-book-summary.mjs --provider openrouter --model deepseek/deepseek-v3.2 -i temp/book.epub -p temp/summarizer_prompt.md --language Hindi --lang-code hi
  node scripts/codex-book-summary.mjs --provider deepseek --env-file ../vendingbench_stocks/.env -i temp/book.epub -p temp/summarizer_prompt.md
  node scripts/codex-book-summary.mjs --resume-run temp/codex_runs/book_20260517_093526
  node scripts/codex-book-summary.mjs --list-openrouter-models deepseek-v3.2
  node scripts/codex-book-summary.mjs -i temp/book.txt --extract-only
`);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--extract-only') args.extractOnly = true;
    else if (arg === '--provider') args.provider = argv[++i];
    else if (arg === '--input' || arg === '-i') args.input = argv[++i];
    else if (arg === '--prompt' || arg === '-p') args.prompt = argv[++i];
    else if (arg === '--model' || arg === '-m') args.model = argv[++i];
    else if (arg === '--language' || arg === '--lang') args.language = argv[++i];
    else if (arg === '--lang-code') args.langCode = argv[++i];
    else if (arg === '--out-dir' || arg === '-o') args.outDir = argv[++i];
    else if (arg === '--run-root') args.runRoot = argv[++i];
    else if (arg === '--cache-dir') args.cacheDir = argv[++i];
    else if (arg === '--codex-bin') args.codexBin = argv[++i];
    else if (arg === '--openrouter-api-key-env') args.openRouterApiKeyEnv = argv[++i];
    else if (arg === '--openrouter-base-url') args.openRouterBaseUrl = argv[++i];
    else if (arg === '--openrouter-session-id') args.openRouterSessionId = argv[++i];
    else if (arg === '--openrouter-cache-ttl') args.openRouterCacheTtl = argv[++i];
    else if (arg === '--deepseek-api-key-env') args.deepSeekApiKeyEnv = argv[++i];
    else if (arg === '--deepseek-base-url') args.deepSeekBaseUrl = argv[++i];
    else if (arg === '--env-file') args.envFile = argv[++i];
    else if (arg === '--list-openrouter-models') {
      const next = argv[i + 1];
      args.listOpenRouterModels = next && !next.startsWith('-') ? argv[++i] : '';
    }
    else if (arg === '--temperature') args.temperature = argv[++i];
    else if (arg === '--reasoning-effort') args.reasoningEffort = argv[++i];
    else if (arg === '--max-output-tokens') args.maxOutputTokens = argv[++i];
    else if (arg === '--no-max-output-tokens') args.noMaxOutputTokens = true;
    else if (arg === '--max-parts') args.maxParts = argv[++i];
    else if (arg === '--continue-prompt') args.continuePrompt = argv[++i];
    else if (arg === '--retries') args.retries = argv[++i];
    else if (arg === '--retry-delay-ms') args.retryDelayMs = argv[++i];
    else if (arg === '--resume-run') args.resumeRun = argv[++i];
    else if (arg === '--workdir') args.workdir = argv[++i];
    else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
    else args._.push(arg);
  }
  return args;
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(filePath) {
  if (!(await exists(filePath))) return null;
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function requiredPositiveInteger(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function nonNegativeInteger(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
  return parsed;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function loadEnvFile(filePath) {
  if (!filePath || !(await exists(filePath))) return false;
  const text = await readFile(filePath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
  return true;
}

function isChatCompletionsProvider(provider) {
  return provider === PROVIDER_OPENROUTER || provider === PROVIDER_DEEPSEEK;
}

function providerDisplayName(provider) {
  if (provider === PROVIDER_OPENROUTER) return 'OpenRouter';
  if (provider === PROVIDER_DEEPSEEK) return 'DeepSeek';
  return 'Codex';
}

function isOpenRouterClaudeModel(provider, model) {
  return provider === PROVIDER_OPENROUTER && /^anthropic\/claude-/i.test(String(model || ''));
}

function isOpenRouterGeminiModel(provider, model) {
  return provider === PROVIDER_OPENROUTER && /^google\/gemini-/i.test(String(model || ''));
}

function isOpenRouterGrokModel(provider, model) {
  return provider === PROVIDER_OPENROUTER && /^x-ai\/grok-/i.test(String(model || ''));
}

function isOpenRouterQwenModel(provider, model) {
  return provider === PROVIDER_OPENROUTER && /^qwen\//i.test(String(model || ''));
}

// Gemini and Qwen honor an embedded cache_control breakpoint on the first message.
// Alibaba Qwen *requires* it to cache at all (verified: no breakpoint -> 0 cached);
// OpenAI/Grok/DeepSeek cache implicitly and need nothing here.
function usesEmbeddedCacheBreakpoint(provider, model) {
  return isOpenRouterGeminiModel(provider, model) || isOpenRouterQwenModel(provider, model);
}

function supportsExplicitOpenRouterCaching(provider, model) {
  return isOpenRouterClaudeModel(provider, model) || usesEmbeddedCacheBreakpoint(provider, model);
}

function normalizeOpenRouterCacheTtl(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return OPENROUTER_DEFAULT_CLAUDE_CACHE_TTL;
  if (normalized === '1h') return '1h';
  if (normalized === '5m' || normalized === '5min' || normalized === '5-min') return '5m';
  if (['none', 'off', 'false', '0', 'disabled'].includes(normalized)) return 'none';
  throw new Error('--openrouter-cache-ttl must be 1h, 5m, or none');
}

function openRouterCacheControl({ provider, model, cacheTtl }) {
  if (!supportsExplicitOpenRouterCaching(provider, model)) return null;
  const ttl = normalizeOpenRouterCacheTtl(cacheTtl);
  if (ttl === 'none') return null;
  const control = { type: 'ephemeral' };
  if (ttl === '1h') {
    if (isOpenRouterGeminiModel(provider, model)) {
      throw new Error('Gemini explicit prompt caching supports the standard 5m TTL, not 1h');
    }
    control.ttl = '1h';
  }
  return control;
}

function withOpenRouterPromptCaching(messages, { provider, model, cacheTtl }) {
  const cacheControl = openRouterCacheControl({ provider, model, cacheTtl });
  if (!cacheControl || !usesEmbeddedCacheBreakpoint(provider, model) || messages.length === 0) return messages;

  const [first, ...rest] = messages;
  if (typeof first?.content !== 'string') return messages;
  const tailTarget = Math.max(0, first.content.length - 2048);
  const paragraphSplit = first.content.lastIndexOf('\n\n', tailTarget);
  const splitAt = paragraphSplit > 0 ? paragraphSplit + 2 : tailTarget;
  const cachedPrefix = first.content.slice(0, splitAt);
  const uncachedTail = first.content.slice(splitAt);
  return [
    {
      ...first,
      content: [
        { type: 'text', text: cachedPrefix, cache_control: cacheControl },
        { type: 'text', text: uncachedTail },
      ],
    },
    ...rest,
  ];
}

function normalizeReasoningEffort(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return undefined;
  const supported = new Set(['max', 'xhigh', 'high', 'medium', 'low', 'minimal', 'none']);
  if (!supported.has(normalized)) {
    throw new Error('--reasoning-effort must be max, xhigh, high, medium, low, minimal, or none');
  }
  return normalized;
}

function timestamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
    '_',
    pad(d.getHours()),
    pad(d.getMinutes()),
    pad(d.getSeconds()),
  ].join('');
}

function slugify(name) {
  return path.basename(name, path.extname(name))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'book';
}

function safeFileName(name) {
  return String(name || 'book')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140)
    .replace(/[. ]+$/g, '') || 'book';
}

function getMarkdownTitle(markdown) {
  const match = /^#\s+(.+)$/m.exec(String(markdown || ''));
  return match ? cleanLine(match[1]) : '';
}

function languageCodeFor(language) {
  const raw = String(language || '').trim();
  const normalized = raw.toLowerCase();
  const common = new Map([
    ['english', 'en'],
    ['en', 'en'],
    ['hindi', 'hi'],
    ['hi', 'hi'],
    ['spanish', 'es'],
    ['es', 'es'],
    ['french', 'fr'],
    ['fr', 'fr'],
    ['german', 'de'],
    ['de', 'de'],
    ['italian', 'it'],
    ['it', 'it'],
    ['portuguese', 'pt'],
    ['pt', 'pt'],
    ['japanese', 'ja'],
    ['ja', 'ja'],
    ['korean', 'ko'],
    ['ko', 'ko'],
    ['chinese', 'zh'],
    ['zh', 'zh'],
  ]);
  if (common.has(normalized)) return common.get(normalized);
  return normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'lang';
}

function isEnglishLanguage(language) {
  return ['english', 'en'].includes(String(language || '').trim().toLowerCase());
}

function languageInstruction(targetLanguage) {
  if (isEnglishLanguage(targetLanguage)) return '';
  return [
    `Write the generated summary in ${targetLanguage}; keep only titles, names, URLs, code-like markers, and <end_of_book> unchanged.`,
    `Use natural, fluent ${targetLanguage}; avoid mixed-language phrasing and unnecessary English words.`,
  ].join('\n');
}

function sourceBoundaryInstruction() {
  return 'Use only the supplied extracted Markdown source; do not infer, invent, or summarize material that is not present in it.';
}

function applyPromptPlaceholders(promptText, { targetLanguage }) {
  const replacements = new Map([
    ['{{LANGUAGE}}', targetLanguage],
    ['{{TARGET_LANGUAGE}}', targetLanguage],
    ['{{LANGUAGE_INSTRUCTION}}', languageInstruction(targetLanguage)],
    ['{{SOURCE_BOUNDARY_INSTRUCTION}}', sourceBoundaryInstruction()],
  ]);
  let output = String(promptText || '');
  for (const [placeholder, replacement] of replacements) {
    output = output.split(placeholder).join(replacement);
  }
  return output.trim();
}

function promptSuffix(promptText, { targetLanguage }) {
  const rawPrompt = String(promptText || '');
  const suffixes = [];
  if (!rawPrompt.includes('{{SOURCE_BOUNDARY_INSTRUCTION}}')) {
    suffixes.push(sourceBoundaryInstruction());
  }
  if (!isEnglishLanguage(targetLanguage) && !rawPrompt.includes('{{LANGUAGE_INSTRUCTION}}')) {
    suffixes.push(languageInstruction(targetLanguage));
  }
  return suffixes.filter(Boolean).join('\n');
}

function expandSummarizerPrompt(promptText, { targetLanguage }) {
  return [
    applyPromptPlaceholders(promptText, { targetLanguage }),
    promptSuffix(promptText, { targetLanguage }),
  ].filter(Boolean).join('\n\n').trim();
}

function normalizeWhitespace(text) {
  return String(text || '')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function countWords(text) {
  return (String(text || '').match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu) || []).length;
}

function estimateTokens(text) {
  return Math.ceil(Buffer.byteLength(String(text || ''), 'utf8') / 4);
}

function cleanLine(text) {
  return String(text || '')
    .replace(/\u0000/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?%)\]”’])/g, '$1')
    .replace(/([([“‘])\s+/g, '$1')
    .replace(/\s+([®™])/g, '$1')
    .trim();
}

function decodeEntities(text) {
  return String(text || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&rdquo;/g, '"')
    .replace(/&ldquo;/g, '"')
    .replace(/&mdash;/g, '-')
    .replace(/&ndash;/g, '-');
}

function stripTags(markup) {
  return cleanLine(decodeEntities(String(markup || '').replace(/<[^>]+>/g, ' ')));
}

async function downloadIfMissing(url, dest) {
  if (await exists(dest)) return;
  await mkdir(path.dirname(dest), { recursive: true });
  console.log(`Downloading extractor module: ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

async function ensurePdfJs(cacheDir) {
  const root = path.join(cacheDir, `pdfjs-${PDFJS_VERSION}`, 'build');
  const pdfJs = path.join(root, 'pdf.mjs');
  const worker = path.join(root, 'pdf.worker.mjs');
  await downloadIfMissing(`https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.mjs`, pdfJs);
  await downloadIfMissing(`https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.mjs`, worker);
  return { pdfJs, worker };
}

async function ensureFflate(cacheDir) {
  const file = path.join(cacheDir, `fflate-${FFLATE_VERSION}`, 'browser.mjs');
  await downloadIfMissing(`https://cdn.jsdelivr.net/npm/fflate@${FFLATE_VERSION}/esm/browser.js`, file);
  return file;
}

function suppressPdfTextOnlyWarnings() {
  const originalWarn = console.warn;
  const originalEmitWarning = process.emitWarning;
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  const shouldSuppress = value => {
    const message = String(value || '');
    return message.includes('@napi-rs/canvas')
      || message.includes('Cannot polyfill')
      || message.includes('Please use the `legacy` build');
  };

  console.warn = (...warnArgs) => {
    if (shouldSuppress(warnArgs[0])) return;
    originalWarn(...warnArgs);
  };
  process.emitWarning = (warning, ...rest) => {
    if (shouldSuppress(warning)) return;
    return originalEmitWarning.call(process, warning, ...rest);
  };
  process.stderr.write = (chunk, encoding, callback) => {
    if (shouldSuppress(chunk)) {
      if (typeof encoding === 'function') encoding();
      if (typeof callback === 'function') callback();
      return true;
    }
    return originalStderrWrite.call(process.stderr, chunk, encoding, callback);
  };
  process.stdout.write = (chunk, encoding, callback) => {
    if (shouldSuppress(chunk)) {
      if (typeof encoding === 'function') encoding();
      if (typeof callback === 'function') callback();
      return true;
    }
    return originalStdoutWrite.call(process.stdout, chunk, encoding, callback);
  };

  return () => {
    console.warn = originalWarn;
    process.emitWarning = originalEmitWarning;
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  };
}

function groupPdfItemsIntoLines(items) {
  const textItems = (items || [])
    .filter(item => typeof item.str === 'string')
    .map(item => ({
      text: item.str,
      x: Number(item.transform?.[4] || 0),
      y: Number(item.transform?.[5] || 0),
    }));

  const groups = [];
  for (const item of textItems) {
    if (!item.text.trim() && groups.length === 0) continue;
    const last = groups[groups.length - 1];
    if (!last || Math.abs(item.y - last.y) > 2.5) {
      groups.push({ y: item.y, items: [item] });
    } else {
      last.items.push(item);
      last.y = (last.y * (last.items.length - 1) + item.y) / last.items.length;
    }
  }

  return groups
    .map(group => group.items.sort((a, b) => a.x - b.x).map(item => item.text).join(' '))
    .map(cleanLine)
    .filter(Boolean);
}

function markdownForPdfLine(line) {
  const stripped = line.replace(/[0-9\s.,:;!?()\-[\]'"/“”‘’®™&]/g, '');
  const alpha = stripped.replace(/[^A-Za-z]/g, '');
  const isUpperHeading = alpha.length >= 6 && alpha === alpha.toUpperCase() && line.length <= 90;
  if (isUpperHeading) return `### ${line}`;
  return line;
}

async function extractPdfToMarkdown(inputPath, cacheDir) {
  const { pdfJs, worker } = await ensurePdfJs(cacheDir);
  const restoreWarnings = suppressPdfTextOnlyWarnings();
  try {
    const { getDocument, GlobalWorkerOptions, VerbosityLevel } = await import(pathToFileURL(pdfJs).href);
    GlobalWorkerOptions.workerSrc = pathToFileURL(worker).href;

    const data = new Uint8Array(await readFile(inputPath));
    const pdf = await getDocument({ data, verbosity: VerbosityLevel.ERRORS }).promise;
    const meta = await pdf.getMetadata().catch(() => ({}));
    const title = meta?.info?.Title || path.basename(inputPath);
    const author = meta?.info?.Author || 'Unknown';
    const output = [
      `# ${title}`,
      '',
      `Author: ${author}`,
      `Source file: \`${inputPath}\``,
      `Format: PDF`,
      `Pages: ${pdf.numPages}`,
      '',
      `> Extracted locally with PDF.js ${PDFJS_VERSION}. Page breaks preserved for downstream summarization.`,
    ];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent({
        includeMarkedContent: false,
        disableNormalization: false,
      });
      const lines = groupPdfItemsIntoLines(textContent.items);
      output.push('', '---', '', `## Page ${pageNumber}`, '');
      if (lines.length === 0) {
        output.push('_No extractable text on this page._');
        continue;
      }
      output.push(...lines.map(markdownForPdfLine));
    }

    return output.join('\n');
  } finally {
    restoreWarnings();
  }
}

function getXmlAttr(tag, attr) {
  const match = new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag);
  return match ? decodeEntities(match[1]) : '';
}

function xmlOpenTagPattern(tagName, flags = 'i') {
  return new RegExp(`<(?:[\\w.-]+:)?${tagName}\\b[^>]*>`, flags);
}

function xmlBlockPattern(tagName, flags = 'i') {
  return new RegExp(`<(?:[\\w.-]+:)?${tagName}\\b[\\s\\S]*?<\\/(?:[\\w.-]+:)?${tagName}>`, flags);
}

function firstXmlOpenTag(xml, tagName) {
  return xmlOpenTagPattern(tagName).exec(String(xml || ''))?.[0] || '';
}

function firstXmlText(xml, tagName) {
  const match = new RegExp(`<[^>]*${tagName}[^>]*>([\\s\\S]*?)<\\/[^>]*${tagName}>`, 'i').exec(xml);
  return match ? cleanLine(decodeEntities(match[1].replace(/<[^>]+>/g, ' '))) : '';
}

function normalizeZipPath(pathLike) {
  return String(pathLike || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

function resolveZipPath(baseFilePath, relativePath) {
  const base = normalizeZipPath(baseFilePath);
  // EPUB hrefs are URIs, so percent-encoded names must be decoded to match zip entries.
  let rawRelative = String(relativePath || '').split('#')[0].split('?')[0];
  try {
    rawRelative = decodeURIComponent(rawRelative);
  } catch { }
  const relative = normalizeZipPath(rawRelative);
  if (!relative) return '';
  if (!base) return relative;
  const baseParts = base.split('/').slice(0, -1);
  const resolved = [];
  for (const part of [...baseParts, ...relative.split('/')]) {
    if (!part || part === '.') continue;
    if (part === '..') resolved.pop();
    else resolved.push(part);
  }
  return resolved.join('/');
}

function htmlToMarkdown(markup) {
  let html = String(markup || '')
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '');

  const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  if (body) html = body[1];

  html = html
    .replace(/<img\b[^>]*>/gi, tag => {
      const alt = getXmlAttr(tag, 'alt') || getXmlAttr(tag, 'title');
      return alt ? `\n\n[Image: ${cleanLine(alt)}]\n\n` : '\n\n';
    })
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, t) => `\n\n# ${stripTags(t)}\n\n`)
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, t) => `\n\n## ${stripTags(t)}\n\n`)
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, t) => `\n\n### ${stripTags(t)}\n\n`)
    .replace(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, (_, t) => `\n\n#### ${stripTags(t)}\n\n`)
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/li>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|blockquote|tr|table|ul|ol)>/gi, '\n\n')
    .replace(/<(p|div|section|article|blockquote|tr|table|ul|ol)[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ');

  return normalizeWhitespace(decodeEntities(html)
    .split('\n')
    .map(line => line.startsWith('- ') ? `- ${cleanLine(line.slice(2))}` : cleanLine(line))
    .join('\n'));
}

function getFirstHeading(markdown) {
  const match = /^#{1,4}\s+(.+)$/m.exec(markdown);
  return match ? cleanLine(match[1]) : '';
}

function isGenericChapterTitle(title) {
  return !title || /^chapter\s+\d+$/i.test(title) || /^untitled$/i.test(title);
}

function parseNcxTitles(ncxXml, ncxPath) {
  const titles = new Map();
  for (const match of String(ncxXml || '').matchAll(xmlBlockPattern('navPoint', 'gi'))) {
    const block = match[0];
    const label = firstXmlText(block, 'text');
    const contentTag = firstXmlOpenTag(block, 'content');
    const src = getXmlAttr(contentTag, 'src');
    if (!label || !src) continue;
    titles.set(resolveZipPath(ncxPath, src), label);
  }
  return titles;
}

function parseHtmlTocTitles(navMarkup, navPath) {
  const titles = new Map();
  for (const match of String(navMarkup || '').matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decodeEntities(match[1]);
    const label = stripTags(match[2]);
    if (!label || !href) continue;
    titles.set(resolveZipPath(navPath, href), label);
  }
  return titles;
}

function getEpubNavTitles({ opfXml, opfPath, manifest, readZipText }) {
  const titles = new Map();
  const merge = sourceMap => {
    for (const [href, title] of sourceMap) {
      titles.set(normalizeZipPath(href), title);
      titles.set(normalizeZipPath(String(href).split('#')[0]), title);
    }
  };

  const spineTag = firstXmlOpenTag(opfXml, 'spine');
  const tocId = getXmlAttr(spineTag, 'toc');
  const ncxItem = manifest.get(tocId) || [...manifest.values()].find(item => item.mediaType.includes('dtbncx') || item.href.match(/\.ncx$/i));
  if (ncxItem?.href) {
    const ncxPath = resolveZipPath(opfPath, ncxItem.href);
    const ncxXml = readZipText(ncxPath);
    if (ncxXml) merge(parseNcxTitles(ncxXml, ncxPath));
  }

  const navItems = [...manifest.values()].filter(item => {
    const props = String(item.properties || '').toLowerCase();
    return props.split(/\s+/).includes('nav') || item.href.match(/nav\.(xhtml|html?)$/i);
  });
  for (const navItem of navItems) {
    const navPath = resolveZipPath(opfPath, navItem.href);
    const navMarkup = readZipText(navPath);
    if (navMarkup) merge(parseHtmlTocTitles(navMarkup, navPath));
  }

  return titles;
}

async function extractEpubToMarkdown(inputPath, cacheDir) {
  const fflatePath = await ensureFflate(cacheDir);
  const { unzipSync, strFromU8 } = await import(pathToFileURL(fflatePath).href);
  const entries = unzipSync(new Uint8Array(await readFile(inputPath)));
  const readZipText = zipPath => {
    const entry = entries[normalizeZipPath(zipPath)];
    return entry ? strFromU8(entry) : '';
  };

  const containerXml = readZipText('META-INF/container.xml');
  if (!containerXml) throw new Error('EPUB container.xml not found');
  const rootfileTag = firstXmlOpenTag(containerXml, 'rootfile');
  const opfPath = getXmlAttr(rootfileTag, 'full-path');
  if (!opfPath) throw new Error('EPUB package path missing');
  const opfXml = readZipText(opfPath);
  if (!opfXml) throw new Error(`EPUB package document missing: ${opfPath}`);

  const title = firstXmlText(opfXml, 'title') || path.basename(inputPath);
  const author = firstXmlText(opfXml, 'creator') || 'Unknown';
  const manifest = new Map();
  for (const match of opfXml.matchAll(xmlOpenTagPattern('item', 'gi'))) {
    const tag = match[0];
    const id = getXmlAttr(tag, 'id');
    if (!id) continue;
    manifest.set(id, {
      href: getXmlAttr(tag, 'href'),
      mediaType: getXmlAttr(tag, 'media-type').toLowerCase(),
      properties: getXmlAttr(tag, 'properties').toLowerCase(),
    });
  }
  const navTitles = getEpubNavTitles({ opfXml, opfPath, manifest, readZipText });

  let spineIds = [...opfXml.matchAll(xmlOpenTagPattern('itemref', 'gi'))]
    .map(match => getXmlAttr(match[0], 'idref'))
    .filter(Boolean);
  if (spineIds.length === 0) spineIds = [...manifest.keys()];

  const chapters = [];
  for (const id of spineIds) {
    const item = manifest.get(id);
    if (!item?.href) continue;
    const mediaType = item.mediaType;
    if (!mediaType.includes('html') && !mediaType.includes('xml') && !item.href.match(/\.(xhtml|html?|xml)$/i)) continue;
    const chapterPath = resolveZipPath(opfPath, item.href);
    const markup = readZipText(chapterPath);
    if (!markup) continue;
    const text = htmlToMarkdown(markup);
    if (!text) continue;
    const heading = getFirstHeading(text);
    const navTitle = navTitles.get(chapterPath);
    chapters.push({
      path: chapterPath,
      title: navTitle || heading || `Chapter ${chapters.length + 1}`,
      text,
    });
  }

  if (chapters.length === 0) throw new Error('No readable EPUB chapters found');

  const output = [
    `# ${title}`,
    '',
    `Author: ${author}`,
    `Source file: \`${inputPath}\``,
    `Format: EPUB`,
    `Chapters: ${chapters.length}`,
    '',
    `> Extracted locally with fflate ${FFLATE_VERSION}. Spine order preserved for downstream summarization.`,
  ];

  chapters.forEach((chapter, index) => {
    const title = isGenericChapterTitle(chapter.title) ? `Chapter ${index + 1}` : chapter.title;
    output.push('', '---', '', `## Chapter ${index + 1}: ${title}`, '', chapter.text);
  });
  return output.join('\n');
}

async function extractTextToMarkdown(inputPath, formatLabel) {
  const text = await readFile(inputPath, 'utf8');
  return [
    `# ${path.basename(inputPath, path.extname(inputPath))}`,
    '',
    `Source file: \`${inputPath}\``,
    `Format: ${formatLabel}`,
    '',
    `> Read as UTF-8 text for downstream summarization.`,
    '',
    '---',
    '',
    normalizeWhitespace(text),
    '',
  ].join('\n');
}

async function extractSourceToMarkdown(inputPath, cacheDir) {
  const ext = path.extname(inputPath).toLowerCase();
  if (ext === '.pdf') return extractPdfToMarkdown(inputPath, cacheDir);
  if (ext === '.epub') return extractEpubToMarkdown(inputPath, cacheDir);
  if (ext === '.txt') return extractTextToMarkdown(inputPath, 'TXT');
  if (ext === '.md' || ext === '.markdown') return extractTextToMarkdown(inputPath, 'Markdown');
  throw new Error(`Unsupported input type: ${ext || '(none)'}. Use PDF, EPUB, TXT, or MD.`);
}

function buildInitialPrompt({ provider, promptText, extractedMarkdown, targetLanguage }) {
  const expandedPrompt = expandSummarizerPrompt(promptText, { targetLanguage });
  if (isChatCompletionsProvider(provider)) {
    return [
      expandedPrompt,
      '',
      '--- EXTRACTED MARKDOWN SOURCE ---',
      extractedMarkdown.trim(),
      '',
    ].join('\n');
  }

  return [
    'You are GPT-5.5 via Codex CLI headless exec. Produce only the requested book-summary chunk as the final answer. No process notes, no tool-use narration, no markdown fence around the whole answer.',
    '',
    'Operational mode: API-like text generation. The book is supplied below as extracted Markdown text from the source file. Do not search the web. Do not edit files. Continue from conversation context when prompted with continue.',
    'Chunking: output one substantial chunk, stop at a natural paragraph break before exhausting context, and append <end_of_book> only when the whole supplied source has actually been covered.',
    '',
    '--- SUPPLIED SUMMARIZER PROMPT ---',
    expandedPrompt,
    '',
    '--- EXTRACTED MARKDOWN SOURCE ---',
    extractedMarkdown.trim(),
    '',
  ].join('\n');
}

async function runCommand({ command, args, input, stdoutFile }) {
  await mkdir(path.dirname(stdoutFile), { recursive: true });
  const stdout = createWriteStream(stdoutFile, { flags: 'w' });
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'inherit'] });
  child.stdout.pipe(stdout);
  // If the child exits before draining stdin (bad flag, auth failure), the write
  // EPIPEs; swallow it so the exit-code error below reports the real failure.
  child.stdin.on('error', () => { });
  if (input != null) {
    child.stdin.end(input);
  } else {
    child.stdin.end();
  }

  const exitCode = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  await new Promise(resolve => stdout.end(resolve));
  if (exitCode !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${exitCode}`);
}

async function parseThreadId(eventsFile) {
  const events = await readFile(eventsFile, 'utf8');
  for (const line of events.split(/\r?\n/)) {
    if (!line.trim().startsWith('{')) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === 'thread.started' && event.thread_id) return event.thread_id;
    } catch {
      // Ignore non-JSON warnings if a future CLI writes them to stdout.
    }
  }
  return '';
}

async function parseUsage(eventsFile) {
  const totals = zeroUsage();
  const events = await readFile(eventsFile, 'utf8');
  for (const line of events.split(/\r?\n/)) {
    if (!line.trim().startsWith('{') || !line.includes('"usage"')) continue;
    try {
      const event = JSON.parse(line);
      if (event.type !== 'turn.completed' || !event.usage) continue;
      totals.turn_count += 1;
      for (const key of ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens']) {
        totals[key] += Number(event.usage[key] || 0);
      }
    } catch {
      // Ignore warnings or partial lines.
    }
  }
  return totals;
}

function zeroUsage() {
  return {
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_write_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    turn_count: 0,
  };
}

function addUsage(a, b) {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    cached_input_tokens: a.cached_input_tokens + b.cached_input_tokens,
    cache_write_input_tokens: a.cache_write_input_tokens + b.cache_write_input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    reasoning_output_tokens: a.reasoning_output_tokens + b.reasoning_output_tokens,
    turn_count: a.turn_count + b.turn_count,
  };
}

function decorateUsage(usage) {
  const uncachedInput = Math.max(0, usage.input_tokens - usage.cached_input_tokens);
  return {
    ...usage,
    uncached_input_tokens: uncachedInput,
    total_model_tokens: usage.input_tokens + usage.output_tokens,
    total_uncached_plus_output_tokens: uncachedInput + usage.output_tokens,
  };
}

function usageSummaryLine(usage) {
  const u = decorateUsage(usage);
  return [
    `turns=${u.turn_count}`,
    `input=${u.input_tokens}`,
    `cached_input=${u.cached_input_tokens}`,
    `cache_write_input=${u.cache_write_input_tokens}`,
    `uncached_input=${u.uncached_input_tokens}`,
    `output=${u.output_tokens}`,
    `reasoning_output=${u.reasoning_output_tokens}`,
    `input+output=${u.total_model_tokens}`,
  ].join(' ');
}

function numberOrZero(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return 0;
}

function openRouterUsage(response) {
  const usage = response?.usage || {};
  const promptDetails = usage.prompt_tokens_details || usage.input_tokens_details || {};
  const completionDetails = usage.completion_tokens_details || usage.output_tokens_details || {};
  return {
    input_tokens: numberOrZero(
      usage.prompt_tokens,
      usage.input_tokens
        + usage.cache_creation_input_tokens
        + usage.cache_read_input_tokens,
      usage.input_tokens,
    ),
    cached_input_tokens: numberOrZero(
      promptDetails.cached_tokens,
      promptDetails.cache_read_tokens,
      promptDetails.cache_read_input_tokens,
      usage.cache_read_input_tokens,
      usage.cached_tokens,
      usage.input_cached_tokens,
    ),
    cache_write_input_tokens: numberOrZero(
      promptDetails.cache_write_tokens,
      promptDetails.cache_creation_tokens,
      promptDetails.cache_creation_input_tokens,
      usage.cache_creation_input_tokens,
      usage.cache_write_tokens,
      usage.input_cache_write_tokens,
    ),
    output_tokens: numberOrZero(usage.completion_tokens, usage.output_tokens),
    reasoning_output_tokens: numberOrZero(
      completionDetails.reasoning_tokens,
      usage.reasoning_tokens,
      usage.reasoning_output_tokens,
    ),
    turn_count: 1,
  };
}

function extractOpenRouterText(response) {
  const content = response?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(part => typeof part === 'string' ? part : part?.text || '')
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || payload?.raw || `${response.status} ${response.statusText}`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function isRetryableChatCompletionsError(error) {
  if (error?.retryable) return true;
  const status = Number(error?.status || 0);
  if ([408, 409, 425, 429].includes(status)) return true;
  if (status >= 500 && status <= 599) return true;
  return !status && ['AbortError', 'TimeoutError', 'TypeError', 'FetchError'].includes(error?.name);
}

async function writeAttemptFailure(responseFile, attempt, error) {
  const suffix = `.attempt_${String(attempt).padStart(2, '0')}.error.txt`;
  const errorFile = responseFile.replace(/\.json$/i, suffix);
  const lines = [
    `time=${new Date().toISOString()}`,
    `attempt=${attempt}`,
    `status=${error?.status || ''}`,
    `name=${error?.name || ''}`,
    `message=${error?.message || error}`,
    '',
  ];
  await writeFile(errorFile, lines.join('\n'));
}

async function callChatCompletionsWithRetries({
  provider,
  apiKey,
  baseUrl,
  model,
  messages,
  temperature,
  reasoningEffort,
  maxOutputTokens,
  openRouterCacheTtl,
  openRouterSessionId,
  responseFile,
  retries,
  retryDelayMs,
}) {
  const maxAttempts = retries + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await callOpenRouter({
        provider,
        apiKey,
        baseUrl,
        model,
        messages,
        temperature,
        reasoningEffort,
        maxOutputTokens,
        openRouterCacheTtl,
        openRouterSessionId,
        responseFile,
      });
      if (!extractOpenRouterText(response).trim()) {
        const error = new Error(`${providerDisplayName(provider)} returned empty content`);
        error.retryable = true;
        throw error;
      }
      return response;
    } catch (error) {
      await writeAttemptFailure(responseFile, attempt, error);
      const canRetry = attempt < maxAttempts && isRetryableChatCompletionsError(error);
      if (!canRetry) throw error;
      const delay = Math.min(retryDelayMs * (2 ** (attempt - 1)), 120000);
      console.error(`${providerDisplayName(provider)} attempt ${attempt}/${maxAttempts} failed (${error.message}); retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
  throw new Error(`${providerDisplayName(provider)} retry loop exhausted unexpectedly`);
}

async function listOpenRouterModelsForCli({ query, baseUrl }) {
  const payload = await fetchJson(`${baseUrl.replace(/\/+$/, '')}/models`);
  const normalizedQuery = String(query || '').trim().toLowerCase();
  const models = (payload?.data || [])
    .filter(model => !normalizedQuery || `${model?.id || ''} ${model?.name || ''}`.toLowerCase().includes(normalizedQuery))
    .sort((a, b) => String(a?.id || '').localeCompare(String(b?.id || '')));

  if (models.length === 0) {
    console.log(`No OpenRouter models matched "${query}".`);
    return;
  }

  for (const model of models) {
    const context = Number(model?.context_length || model?.top_provider?.context_length || 0) || 0;
    const modalities = model?.architecture?.input_modalities?.join(',') || 'unknown';
    console.log(`${model.id}\t${model.name || ''}\tcontext=${context}\tinput=${modalities}`);
  }
}

async function callOpenRouter({ provider, apiKey, baseUrl, model, messages, temperature, reasoningEffort, maxOutputTokens, responseFile, openRouterCacheTtl, openRouterSessionId }) {
  const body = {
    model,
    messages: withOpenRouterPromptCaching(messages, {
      provider,
      model,
      cacheTtl: openRouterCacheTtl,
    }),
    stream: false,
  };
  const cacheControl = openRouterCacheControl({ provider, model, cacheTtl: openRouterCacheTtl });
  if (cacheControl && isOpenRouterClaudeModel(provider, model)) body.cache_control = cacheControl;
  if (provider === PROVIDER_OPENROUTER && openRouterSessionId) body.session_id = openRouterSessionId;
  const parsedTemperature = Number(temperature);
  if (Number.isFinite(parsedTemperature)) body.temperature = parsedTemperature;
  if (reasoningEffort) body.reasoning = { effort: reasoningEffort };
  const parsedMaxTokens = Number.parseInt(maxOutputTokens || '', 10);
  if (Number.isFinite(parsedMaxTokens) && parsedMaxTokens > 0) {
    body.max_tokens = parsedMaxTokens;
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  if (provider === PROVIDER_OPENROUTER) {
    headers['X-Title'] = 'Book Distiller Headless';
  }

  const payload = await fetchJson(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  await writeFile(responseFile, JSON.stringify(payload, null, 2));
  return payload;
}

function providerUsageHeading(provider) {
  if (provider === PROVIDER_OPENROUTER) return 'OpenRouter Reported Usage';
  if (provider === PROVIDER_DEEPSEEK) return 'DeepSeek Reported Usage';
  return 'Codex Reported Usage';
}

function providerUsageNote(provider) {
  if (provider === PROVIDER_OPENROUTER) {
    return [
      'Note: OpenRouter reports prompt/completion tokens when the upstream model provides usage data. Cached input and cache-write input are included when OpenRouter/provider returns cache details.',
      'Book content tokens are estimated from the extracted Markdown. OpenRouter does not report a separate prompt/book breakdown.',
    ];
  }
  if (provider === PROVIDER_DEEPSEEK) {
    return [
      'Note: DeepSeek reports prompt/completion tokens for the whole request. Cached input is included only when the API returns cache details.',
      'Book content tokens are estimated from the extracted Markdown. DeepSeek does not report a separate prompt/book breakdown.',
    ];
  }
  return [
    'Note: Codex reports cached input separately. Input tokens include cached input; uncached input is input minus cached input.',
    'Book content tokens are estimated from the extracted Markdown. Codex reports total turn input, not a separate prompt/book breakdown.',
  ];
}

function buildUsageReport({ provider, inputPath, promptPath, model, targetLanguage, langCode, threadId, runDir, extractedOut, summaryOut, extractedMarkdown, summary, turns, usage }) {
  const extractedStats = {
    bytes: Buffer.byteLength(extractedMarkdown, 'utf8'),
    words: countWords(extractedMarkdown),
    estimated_tokens: estimateTokens(extractedMarkdown),
  };
  const summaryStats = {
    bytes: Buffer.byteLength(summary, 'utf8'),
    words: countWords(summary),
    estimated_tokens: estimateTokens(summary),
  };
  const decorated = decorateUsage(usage);
  const lines = [
    '# Book Summary Usage',
    '',
    `Provider: \`${provider}\``,
    `Input: \`${inputPath}\``,
    `Prompt: \`${promptPath}\``,
    `Model: \`${model}\``,
    `Target language: ${targetLanguage} (\`${langCode}\`)`,
    `Thread/conversation: \`${threadId}\``,
    `Run dir: \`${runDir}\``,
    `Extracted Markdown: \`${extractedOut}\``,
    `Summary: \`${summaryOut}\``,
    '',
    '## Source And Output Estimates',
    '',
    `- Book content token estimate: ~${extractedStats.estimated_tokens} tokens by bytes/4`,
    `- Extracted book content: ${extractedStats.words} words, ${extractedStats.bytes} bytes`,
    `- Final summary: ${summaryStats.words} words, ${summaryStats.bytes} bytes, ~${summaryStats.estimated_tokens} tokens by bytes/4`,
    '',
    `## ${providerUsageHeading(provider)}`,
    '',
    `- Turns: ${decorated.turn_count}`,
    `- Input tokens: ${decorated.input_tokens}`,
    `- Cached input tokens: ${decorated.cached_input_tokens}`,
    `- Cache write input tokens: ${decorated.cache_write_input_tokens}`,
    `- Uncached input tokens: ${decorated.uncached_input_tokens}`,
    `- Output tokens: ${decorated.output_tokens}`,
    `- Reasoning output tokens: ${decorated.reasoning_output_tokens}`,
    `- Total reported input + output tokens: ${decorated.total_model_tokens}`,
    `- Total uncached input + output tokens: ${decorated.total_uncached_plus_output_tokens}`,
    '',
    ...providerUsageNote(provider),
    '',
    '## Per Turn',
    '',
    '| Turn | Output bytes | End marker | Input | Cached input | Cache write input | Uncached input | Output | Reasoning output | Input+output |',
    '| ---: | ---: | :---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];

  for (const turn of turns) {
    const u = decorateUsage(turn.usage);
    lines.push(`| ${turn.part} | ${turn.bytes} | ${turn.reachedEnd ? 'yes' : 'no'} | ${u.input_tokens} | ${u.cached_input_tokens} | ${u.cache_write_input_tokens} | ${u.uncached_input_tokens} | ${u.output_tokens} | ${u.reasoning_output_tokens} | ${u.total_model_tokens} |`);
  }

  return {
    markdown: lines.join('\n') + '\n',
    json: {
      inputPath,
      promptPath,
      provider,
      model,
      targetLanguage,
      langCode,
      threadId,
      runDir,
      extractedOut,
      summaryOut,
      source_estimate: extractedStats,
      book_content_token_estimate: extractedStats.estimated_tokens,
      summary_estimate: summaryStats,
      usage: decorated,
      turns: turns.map(turn => ({ ...turn, usage: decorateUsage(turn.usage) })),
    },
  };
}

function partFileName(partNumber) {
  return `part_${String(partNumber).padStart(3, '0')}.md`;
}

function partPath(runDir, partNumber) {
  return path.join(runDir, partFileName(partNumber));
}

function codexEventsPath(runDir, partNumber) {
  return partPath(runDir, partNumber).replace(/\.md$/, '.events.jsonl');
}

function chatResponsePath(runDir, partNumber, provider) {
  const suffix = provider === PROVIDER_DEEPSEEK ? 'deepseek' : 'openrouter';
  return partPath(runDir, partNumber).replace(/\.md$/, `.${suffix}.response.json`);
}

async function readSequentialPartNumbers(runDir) {
  const files = await readdir(runDir);
  const available = new Set(files
    .map(file => /^part_(\d+)\.md$/.exec(file)?.[1])
    .filter(Boolean)
    .map(value => Number.parseInt(value, 10)));
  const numbers = [];
  for (let partNumber = 1; available.has(partNumber); partNumber += 1) {
    numbers.push(partNumber);
  }
  return numbers;
}

async function loadCompletedChatTurns(runDir, provider) {
  const parts = [];
  const turns = [];
  let usageTotals = zeroUsage();
  let conversationId = '';
  for (const partNumber of await readSequentialPartNumbers(runDir)) {
    const outputFile = partPath(runDir, partNumber);
    const responseFile = chatResponsePath(runDir, partNumber, provider);
    const text = await readFile(outputFile, 'utf8');
    if (!text.trim()) break;
    const response = await readJsonIfExists(responseFile);
    if (!conversationId && response?.id) conversationId = response.id;
    const usage = response ? openRouterUsage(response) : zeroUsage();
    usageTotals = addUsage(usageTotals, usage);
    parts.push(text);
    turns.push({
      part: partNumber,
      outputFile,
      eventsFile: responseFile,
      bytes: Buffer.byteLength(text),
      reachedEnd: text.includes('<end_of_book>'),
      usage,
    });
    if (text.includes('<end_of_book>')) break;
  }
  return { parts, turns, usageTotals, lastText: parts.at(-1) || '', conversationId };
}

async function loadCompletedCodexTurns(runDir) {
  const parts = [];
  const turns = [];
  let usageTotals = zeroUsage();
  for (const partNumber of await readSequentialPartNumbers(runDir)) {
    const outputFile = partPath(runDir, partNumber);
    const eventsFile = codexEventsPath(runDir, partNumber);
    const text = await readFile(outputFile, 'utf8');
    if (!text.trim()) break;
    const usage = await exists(eventsFile) ? await parseUsage(eventsFile) : zeroUsage();
    usageTotals = addUsage(usageTotals, usage);
    parts.push(text);
    turns.push({
      part: partNumber,
      outputFile,
      eventsFile,
      bytes: Buffer.byteLength(text),
      reachedEnd: text.includes('<end_of_book>'),
      usage,
    });
    if (text.includes('<end_of_book>')) break;
  }
  return { parts, turns, usageTotals, lastText: parts.at(-1) || '' };
}

async function readRunThreadId(runDir) {
  const threadFile = path.join(runDir, 'thread_id.txt');
  if (await exists(threadFile)) return (await readFile(threadFile, 'utf8')).trim();
  const firstEvents = codexEventsPath(runDir, 1);
  return await exists(firstEvents) ? await parseThreadId(firstEvents) : '';
}

function buildChatMessages({ provider, promptText, extractedMarkdown, targetLanguage, continuePrompt, parts }) {
  const messages = [
    { role: 'user', content: buildInitialPrompt({ provider, promptText, extractedMarkdown, targetLanguage }) },
  ];
  for (const text of parts) {
    messages.push({ role: 'assistant', content: text });
    if (!text.includes('<end_of_book>')) {
      messages.push({ role: 'user', content: continuePrompt });
    }
  }
  return messages;
}

async function runCodexLoop({
  codexBin,
  model,
  maxParts,
  continuePrompt,
  runDir,
  workdir,
  promptText,
  extractedMarkdown,
  targetLanguage,
  resume,
}) {
  await mkdir(workdir, { recursive: true });
  let parts = [];
  let turns = [];
  let usageTotals = zeroUsage();
  let threadId = '';
  let text = '';

  if (resume) {
    const completed = await loadCompletedCodexTurns(runDir);
    parts = completed.parts;
    turns = completed.turns;
    usageTotals = completed.usageTotals;
    text = completed.lastText;
    threadId = await readRunThreadId(runDir);
    if (parts.length > 0) console.log(`Resume -> found ${parts.length} completed Codex part(s)`);
    if (parts.length > 0 && !threadId) throw new Error(`Cannot resume Codex run without thread_id.txt or ${codexEventsPath(runDir, 1)}`);
    if (text.includes('<end_of_book>')) {
      return {
        threadId,
        summary: parts.map(part => part.trim()).join('\n\n') + '\n',
        reachedEnd: true,
        partCount: parts.length,
        turns,
        usage: usageTotals,
      };
    }
  }

  if (parts.length === 0) {
    const firstPart = partPath(runDir, 1);
    const firstEvents = codexEventsPath(runDir, 1);
    console.log(`Codex part 1 -> ${firstPart}`);
    await runCommand({
      command: codexBin,
      args: [
        '--ask-for-approval', 'never',
        'exec',
        '-C', workdir,
        '--skip-git-repo-check',
        '--ignore-rules',
        '--ignore-user-config',
        '-m', model,
        '-s', 'read-only',
        '--json',
        '-o', firstPart,
        '-',
      ],
      input: buildInitialPrompt({ provider: PROVIDER_CODEX, promptText, extractedMarkdown, targetLanguage }),
      stdoutFile: firstEvents,
    });

    threadId = await parseThreadId(firstEvents);
    if (!threadId) throw new Error(`Could not find thread_id in ${firstEvents}`);
    await writeFile(path.join(runDir, 'thread_id.txt'), `${threadId}\n`);

    text = await readFile(firstPart, 'utf8');
    const usage = await parseUsage(firstEvents);
    usageTotals = addUsage(usageTotals, usage);
    parts.push(text);
    turns.push({
      part: 1,
      outputFile: firstPart,
      eventsFile: firstEvents,
      bytes: Buffer.byteLength(text),
      reachedEnd: text.includes('<end_of_book>'),
      usage,
    });
    console.log(`Part 1 bytes=${Buffer.byteLength(text)} end=${text.includes('<end_of_book>') ? 'yes' : 'no'} ${usageSummaryLine(usage)}`);
  }

  for (let partNumber = parts.length + 1; partNumber <= maxParts && !text.includes('<end_of_book>'); partNumber += 1) {
    const outputFile = partPath(runDir, partNumber);
    const eventsPath = codexEventsPath(runDir, partNumber);
    console.log(`Codex part ${partNumber} -> ${outputFile}`);
    await runCommand({
      command: codexBin,
      args: [
        '--ask-for-approval', 'never',
        'exec',
        'resume',
        '--ignore-user-config',
        '--skip-git-repo-check',
        '-m', model,
        '--json',
        '-o', outputFile,
        threadId,
        continuePrompt,
      ],
      input: null,
      stdoutFile: eventsPath,
    });
    text = await readFile(outputFile, 'utf8');
    const usage = await parseUsage(eventsPath);
    usageTotals = addUsage(usageTotals, usage);
    parts.push(text);
    turns.push({
      part: partNumber,
      outputFile,
      eventsFile: eventsPath,
      bytes: Buffer.byteLength(text),
      reachedEnd: text.includes('<end_of_book>'),
      usage,
    });
    console.log(`Part ${partNumber} bytes=${Buffer.byteLength(text)} end=${text.includes('<end_of_book>') ? 'yes' : 'no'} ${usageSummaryLine(usage)}`);
  }

  return {
    threadId,
    summary: parts.map(part => part.trim()).join('\n\n') + '\n',
    reachedEnd: parts.some(part => part.includes('<end_of_book>')),
    partCount: parts.length,
    turns,
    usage: usageTotals,
  };
}

async function runChatCompletionsLoop({
  provider,
  apiKey,
  baseUrl,
  model,
  maxParts,
  continuePrompt,
  runDir,
  promptText,
  extractedMarkdown,
  targetLanguage,
  temperature,
  reasoningEffort,
  maxOutputTokens,
  openRouterCacheTtl,
  openRouterSessionId,
  retries,
  retryDelayMs,
  resume,
}) {
  let parts = [];
  let turns = [];
  let usageTotals = zeroUsage();
  let conversationId = await readRunThreadId(runDir);
  let text = '';

  if (resume) {
    const completed = await loadCompletedChatTurns(runDir, provider);
    parts = completed.parts;
    turns = completed.turns;
    usageTotals = completed.usageTotals;
    text = completed.lastText;
    if (!conversationId && completed.conversationId) conversationId = completed.conversationId;
    if (parts.length > 0) console.log(`Resume -> found ${parts.length} completed ${providerDisplayName(provider)} part(s)`);
    if (text.includes('<end_of_book>')) {
      return {
        threadId: conversationId || `${provider}-${timestamp()}`,
        summary: parts.map(part => part.trim()).join('\n\n') + '\n',
        reachedEnd: true,
        partCount: parts.length,
        turns,
        usage: usageTotals,
      };
    }
  }

  const messages = buildChatMessages({
    provider,
    promptText,
    extractedMarkdown,
    targetLanguage,
    continuePrompt,
    parts,
  });

  for (let partNumber = parts.length + 1; partNumber <= maxParts; partNumber += 1) {
    const outputFile = partPath(runDir, partNumber);
    const responsePath = chatResponsePath(runDir, partNumber, provider);
    console.log(`${providerDisplayName(provider)} part ${partNumber} -> ${outputFile}`);
    const response = await callChatCompletionsWithRetries({
      provider,
      apiKey,
      baseUrl,
      model,
      messages,
      temperature,
      reasoningEffort,
      maxOutputTokens,
      openRouterCacheTtl,
      openRouterSessionId,
      responseFile: responsePath,
      retries,
      retryDelayMs,
    });
    if (!conversationId) conversationId = response?.id || `${provider}-${timestamp()}`;
    text = extractOpenRouterText(response);
    if (!text.trim()) throw new Error(`${providerDisplayName(provider)} returned empty content for part ${partNumber}`);
    await writeFile(outputFile, text);

    const usage = openRouterUsage(response);
    usageTotals = addUsage(usageTotals, usage);
    parts.push(text);
    turns.push({
      part: partNumber,
      outputFile,
      eventsFile: responsePath,
      bytes: Buffer.byteLength(text),
      reachedEnd: text.includes('<end_of_book>'),
      usage,
    });
    console.log(`Part ${partNumber} bytes=${Buffer.byteLength(text)} end=${text.includes('<end_of_book>') ? 'yes' : 'no'} ${usageSummaryLine(usage)}`);

    if (text.includes('<end_of_book>')) break;
    messages.push({ role: 'assistant', content: text });
    messages.push({ role: 'user', content: continuePrompt });
  }

  await writeFile(path.join(runDir, 'thread_id.txt'), `${conversationId}\n`);
  return {
    threadId: conversationId,
    summary: parts.map(part => part.trim()).join('\n\n') + '\n',
    reachedEnd: parts.some(part => part.includes('<end_of_book>')),
    partCount: parts.length,
    turns,
    usage: usageTotals,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const cwd = process.cwd();
  const resumeRun = args.resumeRun ? path.resolve(cwd, args.resumeRun) : '';
  const resumeMetadata = resumeRun ? await readJsonIfExists(path.join(resumeRun, 'run_metadata.json')) : null;
  if (resumeRun && !resumeMetadata) throw new Error(`Cannot resume: missing ${path.join(resumeRun, 'run_metadata.json')}`);
  if (resumeRun && args.extractOnly) throw new Error('--extract-only cannot be combined with --resume-run');

  const provider = args.provider || resumeMetadata?.provider || PROVIDER_CODEX;
  const openRouterBaseUrl = args.openRouterBaseUrl || resumeMetadata?.openRouterBaseUrl || OPENROUTER_DEFAULT_BASE_URL;
  const deepSeekBaseUrl = args.deepSeekBaseUrl || resumeMetadata?.deepSeekBaseUrl || DEEPSEEK_DEFAULT_BASE_URL;
  if (![PROVIDER_CODEX, PROVIDER_OPENROUTER, PROVIDER_DEEPSEEK].includes(provider)) {
    throw new Error(`Unsupported --provider ${provider}. Use ${PROVIDER_CODEX}, ${PROVIDER_OPENROUTER}, or ${PROVIDER_DEEPSEEK}.`);
  }

  const envFile = args.envFile
    ? path.resolve(cwd, args.envFile)
    : resumeMetadata?.envFile
      ? path.resolve(cwd, resumeMetadata.envFile)
      : '';
  if (envFile) {
    const loaded = await loadEnvFile(envFile);
    if (!loaded) throw new Error(`Env file not found: ${envFile}`);
  }

  if (args.listOpenRouterModels !== undefined) {
    await listOpenRouterModelsForCli({
      query: args.listOpenRouterModels,
      baseUrl: openRouterBaseUrl,
    });
    return;
  }

  const inputArg = args.input || args._[0] || resumeMetadata?.inputPath;
  if (!inputArg) throw new Error('Missing --input <file>');

  const inputPath = path.resolve(cwd, inputArg);
  const promptPath = args.prompt
    ? path.resolve(cwd, args.prompt)
    : resumeMetadata?.promptPath
      ? path.resolve(cwd, resumeMetadata.promptPath)
      : path.resolve(cwd, 'temp/summarizer_prompt.md');
  const model = args.model || resumeMetadata?.model || (
    provider === PROVIDER_OPENROUTER
      ? OPENROUTER_DEFAULT_MODEL
      : provider === PROVIDER_DEEPSEEK
        ? DEEPSEEK_DEFAULT_MODEL
        : 'gpt-5.5'
  );
  const targetLanguage = args.language || resumeMetadata?.targetLanguage || 'English';
  const langCode = safeFileName(args.langCode || resumeMetadata?.langCode || languageCodeFor(targetLanguage)).toLowerCase();
  const outDir = path.resolve(cwd, args.outDir || (resumeMetadata?.summaryOut ? path.dirname(resumeMetadata.summaryOut) : path.dirname(inputPath)));
  const runRoot = path.resolve(cwd, args.runRoot || 'temp/codex_runs');
  const cacheDir = path.resolve(cwd, args.cacheDir || 'temp/codex_book_summary_cache');
  const codexBin = args.codexBin || resumeMetadata?.codexBin || 'codex';
  const openRouterApiKeyEnv = args.openRouterApiKeyEnv || resumeMetadata?.openRouterApiKeyEnv || 'OPENROUTER_API_KEY';
  const deepSeekApiKeyEnv = args.deepSeekApiKeyEnv || resumeMetadata?.deepSeekApiKeyEnv || 'DEEPSEEK_API_KEY';
  const maxParts = requiredPositiveInteger(args.maxParts || resumeMetadata?.maxParts || '20', '--max-parts');
  const continuePrompt = args.continuePrompt || resumeMetadata?.continuePrompt || 'continue';
  const workdir = path.resolve(cwd, args.workdir || path.join(os.tmpdir(), 'codex-headless-book-summary'));
  const retries = nonNegativeInteger(args.retries ?? resumeMetadata?.retries ?? String(DEFAULT_RETRIES), '--retries');
  const retryDelayMs = requiredPositiveInteger(args.retryDelayMs || resumeMetadata?.retryDelayMs || String(DEFAULT_RETRY_DELAY_MS), '--retry-delay-ms');
  const openRouterCacheTtl = provider === PROVIDER_OPENROUTER && supportsExplicitOpenRouterCaching(provider, model)
    ? normalizeOpenRouterCacheTtl(args.openRouterCacheTtl || resumeMetadata?.openRouterCacheTtl || OPENROUTER_DEFAULT_CLAUDE_CACHE_TTL)
    : 'none';
  const openRouterSessionId = provider === PROVIDER_OPENROUTER
    ? String(args.openRouterSessionId ?? resumeMetadata?.openRouterSessionId ?? '').trim()
    : '';
  if (openRouterSessionId.length > 256) throw new Error('--openrouter-session-id must be at most 256 characters');

  const noMaxOutputTokens = Boolean(args.noMaxOutputTokens || resumeMetadata?.noMaxOutputTokens);
  const maxOutputTokens = noMaxOutputTokens
    ? undefined
    : args.maxOutputTokens || resumeMetadata?.maxOutputTokens || undefined;
  if (maxOutputTokens != null) {
    requiredPositiveInteger(maxOutputTokens, '--max-output-tokens');
  }
  const temperature = args.temperature ?? resumeMetadata?.temperature;
  if (temperature != null && !Number.isFinite(Number(temperature))) throw new Error('--temperature must be a number');
  const reasoningEffort = normalizeReasoningEffort(args.reasoningEffort ?? resumeMetadata?.reasoningEffort);
  const metadataExtractedOut = resumeMetadata?.extractedOut ? path.resolve(cwd, resumeMetadata.extractedOut) : '';
  const canUseExistingExtract = Boolean(resumeRun && metadataExtractedOut && await exists(metadataExtractedOut));
  const runPromptPath = resumeRun ? path.join(resumeRun, 'summarizer_prompt.md') : '';
  const canUsePromptCopy = Boolean(resumeRun && runPromptPath && await exists(runPromptPath));
  if (!canUseExistingExtract && !(await exists(inputPath))) throw new Error(`Input not found: ${inputPath}`);
  const promptFileExists = await exists(promptPath);
  // An explicitly requested or resumed prompt must exist; without one, fall back to the built-in prompt.
  if (!args.extractOnly && !canUsePromptCopy && !promptFileExists && (args.prompt || resumeRun)) {
    throw new Error(`Prompt not found: ${promptPath}`);
  }
  const usingBuiltInPrompt = !canUsePromptCopy && !promptFileExists;
  const chatApiKeyEnv = provider === PROVIDER_DEEPSEEK ? deepSeekApiKeyEnv : openRouterApiKeyEnv;
  if (!args.extractOnly && isChatCompletionsProvider(provider) && !process.env[chatApiKeyEnv]) {
    if (provider === PROVIDER_DEEPSEEK) {
      const discovered = await loadEnvFile('/Users/pankaj/work/content/vendingbench_stocks/.env');
      if (discovered && process.env[chatApiKeyEnv]) {
        console.log('Loaded DeepSeek API key from discovered work/content env file.');
      }
    }
  }
  if (!args.extractOnly && isChatCompletionsProvider(provider) && !process.env[chatApiKeyEnv]) {
    const providerName = providerDisplayName(provider);
    const flag = provider === PROVIDER_DEEPSEEK ? '--deepseek-api-key-env' : '--openrouter-api-key-env';
    const envName = provider === PROVIDER_DEEPSEEK ? deepSeekApiKeyEnv : openRouterApiKeyEnv;
    throw new Error(`Missing ${providerName} API key. Set ${envName}=..., pass ${flag} <name>, or pass --env-file <file>.`);
  }
  const stem = slugify(inputPath);
  const runDir = resumeRun || path.join(runRoot, `${stem}_${timestamp()}`);

  await mkdir(outDir, { recursive: true });
  await mkdir(runDir, { recursive: true });

  if (resumeRun) console.log(`Resuming run -> ${runDir}`);
  console.log(`Extracting ${inputPath}`);
  console.log(`Provider -> ${provider}`);
  console.log(`Model -> ${model}`);
  if (provider === PROVIDER_OPENROUTER) {
    const cacheLabel = isOpenRouterGrokModel(provider, model)
      ? 'automatic (provider-managed)'
      : supportsExplicitOpenRouterCaching(provider, model)
        ? `explicit ${openRouterCacheTtl}`
        : 'provider/model default';
    console.log(`OpenRouter prompt cache -> ${cacheLabel}`);
  }
  if (reasoningEffort) console.log(`Reasoning effort -> ${reasoningEffort}`);
  const extractedMarkdown = resumeRun && metadataExtractedOut && await exists(metadataExtractedOut)
    ? await readFile(metadataExtractedOut, 'utf8')
    : await extractSourceToMarkdown(inputPath, cacheDir);
  const bookName = safeFileName(resumeMetadata?.bookName || getMarkdownTitle(extractedMarkdown) || path.basename(inputPath, path.extname(inputPath)));
  const extractedOut = metadataExtractedOut || path.join(outDir, `${bookName} - extracted.md`);
  const summaryOut = resumeMetadata?.summaryOut ? path.resolve(cwd, resumeMetadata.summaryOut) : path.join(outDir, `${bookName} - summary - ${langCode}.md`);
  const usageOut = path.join(path.dirname(summaryOut), `${bookName} - usage - ${langCode}.md`);
  const usageJsonOut = path.join(path.dirname(summaryOut), `${bookName} - usage - ${langCode}.json`);
  if (!(resumeRun && await exists(extractedOut))) await writeFile(extractedOut, extractedMarkdown);
  await copyFile(extractedOut, path.join(runDir, path.basename(extractedOut)));
  console.log(`Extracted Markdown -> ${extractedOut}`);
  console.log(`Target language -> ${targetLanguage} (${langCode})`);
  console.log(`Book content estimate -> words=${countWords(extractedMarkdown)} bytes=${Buffer.byteLength(extractedMarkdown, 'utf8')} tokens_est_bytes_div_4=${estimateTokens(extractedMarkdown)}`);

  if (args.extractOnly) {
    console.log('extract-only: done');
    return;
  }

  const promptCopyPath = path.join(runDir, 'summarizer_prompt.md');
  const promptText = resumeRun && await exists(promptCopyPath)
    ? await readFile(promptCopyPath, 'utf8')
    : usingBuiltInPrompt
      ? DEFAULT_PROMPT
      : await readFile(promptPath, 'utf8');
  if (!(resumeRun && await exists(promptCopyPath))) {
    await writeFile(promptCopyPath, promptText);
  }
  const promptLabel = usingBuiltInPrompt ? '(built-in distillation prompt)' : promptPath;
  console.log(`Prompt -> ${promptLabel}`);

  await writeFile(path.join(runDir, 'run_metadata.json'), JSON.stringify({
    inputPath,
    promptPath: usingBuiltInPrompt ? undefined : promptPath,
    model,
    provider,
    targetLanguage,
    langCode,
    bookName,
    extractedOut,
    summaryOut,
    runDir,
    maxParts,
    continuePrompt,
    codexBin,
    retries,
    retryDelayMs,
    noMaxOutputTokens,
    envFile: envFile || undefined,
    openRouterBaseUrl: provider === PROVIDER_OPENROUTER ? openRouterBaseUrl : undefined,
    openRouterApiKeyEnv: provider === PROVIDER_OPENROUTER ? openRouterApiKeyEnv : undefined,
    openRouterCacheTtl: provider === PROVIDER_OPENROUTER ? openRouterCacheTtl : undefined,
    openRouterSessionId: provider === PROVIDER_OPENROUTER && openRouterSessionId ? openRouterSessionId : undefined,
    deepSeekBaseUrl: provider === PROVIDER_DEEPSEEK ? deepSeekBaseUrl : undefined,
    deepSeekApiKeyEnv: provider === PROVIDER_DEEPSEEK ? deepSeekApiKeyEnv : undefined,
    temperature: temperature ?? undefined,
    reasoningEffort: reasoningEffort ?? undefined,
    maxOutputTokens: maxOutputTokens ?? undefined,
    createdAt: resumeMetadata?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }, null, 2));

  const result = isChatCompletionsProvider(provider)
    ? await runChatCompletionsLoop({
        provider,
        apiKey: process.env[chatApiKeyEnv],
        baseUrl: provider === PROVIDER_DEEPSEEK ? deepSeekBaseUrl : openRouterBaseUrl,
        model,
        maxParts,
        continuePrompt,
        runDir,
        promptText,
        extractedMarkdown,
        targetLanguage,
        temperature,
        reasoningEffort,
        maxOutputTokens,
        openRouterCacheTtl,
        openRouterSessionId,
        retries,
        retryDelayMs,
        resume: Boolean(resumeRun),
      })
    : await runCodexLoop({
        codexBin,
        model,
        maxParts,
        continuePrompt,
        runDir,
        workdir,
        promptText,
        extractedMarkdown,
        targetLanguage,
        resume: Boolean(resumeRun),
      });

  await writeFile(summaryOut, result.summary);
  await copyFile(summaryOut, path.join(runDir, path.basename(summaryOut)));
  const usageReport = buildUsageReport({
    provider,
    inputPath,
    promptPath: promptLabel,
    model,
    targetLanguage,
    langCode,
    threadId: result.threadId,
    runDir,
    extractedOut,
    summaryOut,
    extractedMarkdown,
    summary: result.summary,
    turns: result.turns,
    usage: result.usage,
  });
  await writeFile(usageOut, usageReport.markdown);
  await writeFile(usageJsonOut, JSON.stringify(usageReport.json, null, 2));
  await copyFile(usageOut, path.join(runDir, path.basename(usageOut)));
  await copyFile(usageJsonOut, path.join(runDir, path.basename(usageJsonOut)));
  console.log(`Summary -> ${summaryOut}`);
  console.log(`Usage -> ${usageOut}`);
  console.log(`Run dir -> ${runDir}`);
  console.log(`Thread -> ${result.threadId}`);
  console.log(`Parts -> ${result.partCount}`);
  console.log(`Token usage -> ${usageSummaryLine(result.usage)}`);
  console.log(`End marker -> ${result.reachedEnd ? 'yes' : 'no'}`);

  if (!result.reachedEnd) {
    process.exitCode = 2;
    console.error(`Stopped after ${result.partCount} parts without <end_of_book>. Resume with: node scripts/codex-book-summary.mjs --resume-run ${runDir} --max-parts ${maxParts + 5}`);
  }
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
