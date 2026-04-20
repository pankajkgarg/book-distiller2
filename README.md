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
  - Model list is fetched dynamically from OpenRouter and filtered by the current source mode

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
