# Book Distiller (Petite‑Vue)

Live site: https://pankajkgarg.github.io/book-distiller2/

A static client-side app that uploads a book, optionally extracts its text locally in the browser, and iteratively distills it with either Google AI Studio or OpenRouter. Built with Petite‑Vue; no backend required.

## How It Works

See `docs/WORKFLOW.md` for the authoritative runtime flow, retries, provider behavior, and source handling. Keep that doc updated alongside code changes.

## Getting Started

- Install deps: `npm install`
- Start dev server: `npm run dev`
- Open the printed URL (for example `http://localhost:5173`)

## Scripts

- `npm run dev`: Vite dev server with hot reload
- `npm run build`: Production build to `dist/`
- `npm run preview`: Preview the built site locally
- `npm run book:summary -- --input temp/book.pdf --prompt temp/summarizer_prompt.md`: Extract a PDF/EPUB/TXT/MD source locally, run `codex exec -m gpt-5.5`, and continue until `<end_of_book>`
- `npm test`: Vitest unit tests over the pure `core.js` helpers
- `npm run test:e2e`: Playwright end-to-end suite with mocked provider responses
- `npm run test:e2e:headed`: Same suite in a headed browser
- `npm run test:e2e:real`: Real OpenRouter smoke test against the live API

## Runtime Model

- Static deployment remains the default. The GitHub Pages workflow publishes the repository root.
- API keys stay in browser `localStorage` on the current machine.
- Prompt, provider, source mode, model, temperature, and theme also persist in `localStorage`.
- External runtime libraries are loaded from CDNs:
  - Petite‑Vue
  - Google GenAI SDK
  - PDF.js for local PDF extraction
  - `fflate` for local EPUB unpacking
  - Marked for Markdown rendering
  - jsPDF for export

## Providers

- `Google AI Studio`
  - Supports `Native file` and `Extracted text`
  - Native mode keeps the Gemini Files API upload/poll flow for PDF and EPUB
- `OpenRouter`
  - Supports `Native file` for PDF only
  - Supports `Extracted text` for PDF and EPUB
  - Model list is fetched dynamically from OpenRouter, filtered by the current source mode, and limited to models added within the last 12 months
  - The picker includes a text filter so you can narrow recent models quickly

## Source Modes

- `Native file`
  - Sends the source document directly when the provider supports it
  - Best fit for Google AI Studio PDF/EPUB and OpenRouter PDF
- `Extracted text`
  - Extracts source text locally in the browser first
  - Works for PDF and EPUB across both providers
  - Shows local `Words` and `Est. tokens` counts after analysis

Token counts are estimates only and use a simple `chars / 4` heuristic.

## Notes

- Left pane flow:
  - choose provider
  - choose source mode
  - enter a provider-specific API key
  - choose a provider-aware model
  - upload your book
  - edit the distillation prompt
- Local extraction runs after file selection, even if you later run in `Native file` mode.
- OpenRouter native mode requires a PDF. Use `Extracted text` for EPUB.
- Requests continue to omit search tools on the Google side.

## Export

- Filenames use `<Book Name> - book excerpt.(md|txt|pdf)`.
- Metadata now includes provider and source mode in addition to model, temperature, sections, and date.
- `.md`: YAML front matter
- `.txt`: plain header block
- `.pdf`: PDF document properties

## CLI (Headless Book Summary)

The browser is optional: `scripts/codex-book-summary.mjs` is a full CLI for the same distill-until-`<end_of_book>` loop. Install it as a global `book-distill` command with:

```bash
npm link   # from the repo root; then `book-distill` works anywhere
```

The `--prompt` flag is optional. Resolution order: `--prompt <file>` → `temp/summarizer_prompt.md` (if present in the working directory) → the built-in distillation prompt (the same default the browser app uses, shared via `core.js`). The minimal invocation is just:

```bash
OPENROUTER_API_KEY=... book-distill --provider openrouter --input book.epub
```

Or with an explicit prompt and model:

```bash
node scripts/codex-book-summary.mjs \
  --input temp/The_First_90_Days_First_3_Sections.pdf \
  --prompt temp/summarizer_prompt.md \
  --model gpt-5.5 \
  --language English
```

To use OpenRouter, set `OPENROUTER_API_KEY` and pass any OpenRouter model id. OpenRouter defaults to DeepSeek V3.2 when `--provider openrouter` is selected:

```bash
OPENROUTER_API_KEY=... node scripts/codex-book-summary.mjs \
  --provider openrouter \
  --model deepseek/deepseek-v3.2 \
  --input temp/books/book.epub \
  --prompt temp/summarizer_prompt.md \
  --language Hindi \
  --lang-code hi
```

To call DeepSeek directly, set `DEEPSEEK_API_KEY` or load it from an env file. Direct DeepSeek defaults to `deepseek-chat`; pass `--model deepseek-v4-flash` or `--model deepseek-v4-pro` for the current direct API model ids.

```bash
node scripts/codex-book-summary.mjs \
  --provider deepseek \
  --env-file ../vendingbench_stocks/.env \
  --model deepseek-chat \
  --input temp/books/book.epub \
  --prompt temp/summarizer_prompt.md
```

To discover OpenRouter model ids:

```bash
node scripts/codex-book-summary.mjs --list-openrouter-models deepseek-v3.2
```

OpenRouter and direct DeepSeek runs omit `max_tokens` by default so the upstream model/provider chooses the output length. Pass `--max-output-tokens` only when you intentionally want a per-turn cap.

Chat-completions provider calls retry transient failures by default:

```bash
node scripts/codex-book-summary.mjs \
  --provider openrouter \
  --input temp/books/book.epub \
  --prompt temp/summarizer_prompt.md \
  --retries 3 \
  --retry-delay-ms 15000
```

For OpenRouter Claude models (`anthropic/claude-*`), the browser app and headless script enable Anthropic prompt caching by default with the standard 5-minute TTL. The cache refreshes each time it is used, which is the cheapest option for continuous continuation loops. Use `--openrouter-cache-ttl 1h` only when a run is expected to pause longer than 5 minutes between turns, or disable with `--openrouter-cache-ttl none` only when intentionally testing uncached behavior.

If a run stops after writing one or more `part_###.md` files, resume it from the run directory:

```bash
node scripts/codex-book-summary.mjs \
  --resume-run temp/codex_runs/book_20260517_093526
```

Resume keeps completed parts, rebuilds conversation context, and continues from the next missing part. For OpenRouter, this avoids regenerating already completed output, but Chat Completions is stateless, so the resumed request still sends prior conversation context for continuity. Claude runs add OpenRouter `cache_control` so repeated book/prompt input can be billed as cached input when the provider returns a cache hit.

The script:

- extracts `.pdf`, `.epub`, `.txt`, or `.md` to `<Book Name> - extracted.md`
- runs `codex exec`, OpenRouter Chat Completions, or direct DeepSeek Chat Completions against the extracted Markdown
- sends Codex runs with a small Codex-specific wrapper, but sends OpenRouter/DeepSeek runs as plain prompt + extracted source
- appends the source-boundary line to the summarizer prompt before the extracted source, so nothing is added after the book Markdown
- retries transient OpenRouter/DeepSeek failures and supports `--resume-run` from the last completed part
- continues with the configured provider until `<end_of_book>` or `--max-parts`
- writes `<Book Name> - summary - <lang>.md` plus chunk/event files under `temp/codex_runs/`
- writes `<Book Name> - usage - <lang>.md` and `.json` with book-token estimate, turn count, input tokens, cached input tokens, cache-write input tokens, uncached input tokens, output tokens, and reasoning output tokens

To generate a translated summary, set `--language` and optionally a filename suffix with `--lang-code`. For non-English languages, the script appends a short language instruction to the summarizer prompt before the extracted source; English runs do not get a language instruction.

```bash
node scripts/codex-book-summary.mjs \
  --input temp/books/book.epub \
  --prompt temp/summarizer_prompt.md \
  --language Hindi \
  --lang-code hi
```

Optional prompt placeholders let you control where the generated lines land inside `temp/summarizer_prompt.md`:

- `{{SOURCE_BOUNDARY_INSTRUCTION}}`
- `{{LANGUAGE_INSTRUCTION}}`
- `{{LANGUAGE}}` or `{{TARGET_LANGUAGE}}`

If the first two placeholders are absent, their generated lines are appended to the summarizer prompt before the source text.

For extraction only:

```bash
node scripts/codex-book-summary.mjs --input temp/book.pdf --extract-only
```

Caveat: this workflow deliberately extracts locally first, then sends clean Markdown text to the selected model provider.

## Troubleshooting

- Do not open `index.html` via `file://`; browsers block ESM and remote module loading there. Use `npm run dev` or any static server.
- Ensure your network allows access to the CDNs, Google APIs, and OpenRouter.
- Transient API errors auto-retry with visible countdowns:
  - `429` and `5xx`: fixed 60s wait, up to 4 automatic attempts
  - other transient failures: exponential backoff with jitter
- Content anomalies:
  - short/empty output: retried automatically (60s × 5) before pausing
  - leaked `<ctrl94>` marker: retried automatically (60s × 5) before pausing
- Local extraction can fail on malformed PDFs/EPUBs. In that case:
  - counts show as unavailable
  - Google native mode may still work
  - OpenRouter extracted-text mode will remain blocked until extraction succeeds

## Automated Browser Testing

- Install browsers once: `npx playwright install chromium`
- Run deterministic UI coverage: `npm run test:e2e`
- Run the live OpenRouter smoke test:
  - `OPENROUTER_API_KEY=... OPENROUTER_E2E_MODEL=google/gemma-4-31b-it:free npm run test:e2e:real`
- Test fixtures live in `tests/fixtures/` and currently cover:
  - small PDF extraction
  - small EPUB extraction
  - OpenRouter native EPUB validation
  - provider/source-mode model refresh

The real smoke test uses `Extracted text` mode with a tiny EPUB so the run stays cheap and fast.

## Folder Layout

- `index.html`: static markup and UI bindings
- `app.js`: Petite‑Vue state and orchestration
- `core.js`: pure helpers, storage migration, model normalization
- `providers.js`: Google AI Studio and OpenRouter adapters
- `extractors.js`: browser-side PDF/EPUB extraction
- `styles.css`: UI styling
- `docs/WORKFLOW.md`: runtime behavior reference

## Changelog

See `CHANGELOG.md` for notable changes.

## Contributing

Please see `AGENTS.md` for the project checklist. User-visible changes should update both `CHANGELOG.md` and any impacted docs.

## Deploy to GitHub Pages

This remains a static site. The included GitHub Actions workflows publish it to GitHub Pages on pushes to `main`.

Steps:

1. GitHub → Settings → Pages → Build and deployment → Source: select `GitHub Actions`.
2. Push to `main` or run the workflow manually.

Notes:

- The workflow uploads the repository root.
- If you later prefer a built bundle via Vite, switch the Pages artifact path to `dist` and add a build step.

---

Previously this project lived as a single HTML file. It is now split into HTML/CSS/JS and served via Vite for smoother local development while still shipping as a static app.
