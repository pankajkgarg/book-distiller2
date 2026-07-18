# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- feat: add `gemini-3.1-pro-preview`, `gemini-3-pro-preview`, and `gemini-3-flash-preview` as selectable Google models.
- feat: add provider selection with `Google AI Studio` and `OpenRouter`.
- feat: add source mode selection with `Native file` and `Extracted text`.
- feat: add browser-side PDF and EPUB text extraction with local word/token estimates.
- feat: add a headless `codex exec` book-summary script for PDF, EPUB, TXT, and Markdown sources.
- feat: report headless summary token usage, including book-token estimate, turns, input, cached input, cache-write input, output, and reasoning output.
- feat: write headless summaries as `<Book Name> - summary - <lang>.md` and support translated summaries with `--language`.
- feat: support prompt placeholders for generated headless source-boundary and language instructions.
- feat: add OpenRouter provider support to the headless summary script, including all OpenRouter model ids and a model-list command.
- feat: enable OpenRouter Claude prompt caching by default with the standard 5-minute TTL in the browser app and headless summary script.
- feat: add direct DeepSeek provider support for headless summaries, including dotenv key loading.
- feat: default chat-completions headless runs to omit `max_tokens`; `--max-output-tokens` is opt-in for explicit caps.
- feat: add chat-completions retry support and `--resume-run` checkpoint resume for headless book-summary runs.
- fix: add a source-boundary prompt suffix to headless runs so excerpt summaries do not infer missing chapters.
- fix: send OpenRouter headless calls as plain prompt + source, with no suffix after the book Markdown.
- feat: add dynamic OpenRouter model loading and provider-scoped API key storage.
- test: add Playwright E2E coverage for local extraction, provider validation, model refresh, and a real OpenRouter smoke path.
- feat: limit OpenRouter model picker to models added in the last 12 months and add inline model search filtering.
- feat: make the headless script a first-class `book-distill` CLI: `bin` entry for `npm link`, optional `--prompt` with the browser app's built-in distillation prompt as fallback (shared via `core.js`).
- test: restore the Vitest unit-test pipeline (`npm test`) and add coverage for model recency/search filtering.
- ci: add a GitHub Actions workflow running unit and mocked E2E tests on push/PR.

### Changed
- refactor: extract the duplicated first-turn/continuation generation loop in `app.js` into shared `runGenerationTurn`/`recordTurn` helpers.
- refactor: pin CDN versions for `petite-vue` (0.4.1) and `marked` (15.0.12) so unversioned CDN updates cannot silently change app behavior.
- refactor: move the dead root `gemini.js` (superseded by `providers.js`) to `trash/`.

### Fixed
- fix: anomaly retries (short output, artifact leak) now count attempts, so runs pause after 5 failed retries instead of retrying forever while showing "1/5".
- fix: pausing (user pause, refusal, or repetition loop) keeps the run resumable; previously Resume could silently restart the distillation from turn 1.
- fix: a final response containing only the end marker is treated as completion instead of a "response too short" anomaly, and is not recorded as a document section.
- fix: match the end marker as a plain text suffix, so custom markers with regex metacharacters work.
- fix: render toast messages as plain text instead of HTML.
- fix: auto wait 60s now includes time taken by previous request (starts counting from when request begins, not when it ends)
- fix: clear the retry banner and `retrying` status once a request succeeds after transient retries.
- fix: send the documented `X-Title` attribution header to OpenRouter instead of `X-OpenRouter-Title`.
- fix: percent-decode EPUB manifest hrefs so chapters with encoded filenames are not silently dropped (browser and headless extractors).
- fix: headless script no longer crashes with EPIPE when `codex` exits before reading stdin, honors `--retries 0` on resume, and persists `--codex-bin` in run metadata.
- fix: ignore `.env`, `temp/`, `trash/`, and Playwright output dirs in git.
- fix: make E2E model-list stubs use clock-relative `created` dates so the 12-month recency filter does not rot the tests.
- fix: support namespace-prefixed OPF/NCX tags in the headless EPUB extractor.
- fix: remove unused Vue plugin dependency from Vite configs so `npm run dev` works in the static Petite-Vue app checkout.
- test: make Playwright start its own Vite server by default instead of reusing any existing process on port `4173`, so local E2E catches dev-server startup failures.
- docs: rewrite README and workflow docs for multi-provider and local extraction behavior.

## 2025-09-30
- fix: ensure 429/5xx errors always wait the full 60s before retrying (even during upload) and pause only after 4 consecutive failures.
- docs: update retry-limit documentation to reflect the 4-attempt cap for rate/server overload responses.

## 2025-09-17
- fix: treat root-level Gemini error status strings (e.g., `RESOURCE_EXHAUSTED`) as transient so auto-retries trigger again.
- feat: add an “Auto wait 60s between requests” toggle with a visible countdown before the next turn.

## 2025-08-21
- feat: auto-retry 429 and 5xx with a fixed 60s wait and visible countdown; only pause and show “Resume” after 5 failed attempts.
- docs: clarify retry behavior in README (fixed 60s for 429/5xx with 5 attempts; exponential for others).
 - ui: top status uses colored badge + spinner; end marker hidden from top.
 - ui: left pane simplified into steps (API key → Model → Upload → Prompt); Temperature moved under Advanced.
 - ux: temperature now enabled by default at 1.0.
 - ux: remove misleading token estimate on upload.
 - feat: short/empty responses now auto-retry up to 5 times with a 60s countdown before pausing.
 - fix: detect leaked thoughts token `<ctrl94>` in responses; reject and auto-retry like short/empty (60s × 5), without adding the bad turn to history.
 - feat: allow deleting any generated section; deletion also removes the corresponding user/model messages from history so future turns exclude it.

## 2025-08-19
- Feat: export filenames now use `<Book Name> - book excerpt.(md|txt|pdf)` and include metadata (model, temperature, sections; front matter in `.md`, header in `.txt`, and PDF document properties in `.pdf`).
- Docs: added `docs/WORKFLOW.md` documenting the full runtime workflow, retries, and invalid file URI recovery; referenced from code and README.
- Fix: only send "Next" on subsequent turns (no file reattachment); first turn still includes the uploaded file for context.
- Fix: when a file URI becomes invalid, re-upload once and update prior history file parts to reference the new URI.
- Refactor: extracted Gemini SDK wiring and retry/backoff logic into a new `gemini.js` service.
- app state remains in `app.js`; it now delegates API calls to `gemini.js`.
- Behavior preserved; retry UI (spinner/countdown) still updates via service callbacks.
- Sets groundwork for swapping providers or models with a thin service layer.

- Feat: updated model options to `gemini-2.5-pro`, `gemini-2.5-flash`, and `gemini-2.5-flash-lite`; normalized default to allowed set.
- UI: widened model dropdown for readability; modernized file chooser button; display a rough token estimate (size/4) after upload.
- Docs: linked `CHANGELOG.md` from README and added Pages deployment instructions.
- CI: added GitHub Actions workflow to publish to GitHub Pages on push to `main`.
- Fix: explicitly send empty `tools` array in Gemini requests to avoid Google Search grounding.

## 2025-08-24
- feat: display Gemini `candidatesTokenCount` on each section in Live Document.
- docs: README notes per-section token count in the Live Document UI.
 - refactor: replace manual DOM updates with idiomatic Petite‑Vue rendering
   - Live Document now uses `v-for` over `sectionsMeta` with `v-html` for Markdown
   - Trace drawer renders via `v-for` over `trace` (reversed) instead of imperative DOM
   - Removed direct `innerHTML`/`appendChild` calls; UI stays in sync reactively
