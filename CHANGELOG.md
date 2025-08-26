# Changelog

All notable changes to this project will be documented in this file.

## 2025-08-25
- fix: accept an end-of-book-only reply (`<end_of_book>`) as valid completion instead of flagging it as a short/empty anomaly; retries no longer trigger in this case.
- docs: clarify in README and WORKFLOW that short/empty responses are paused unless the reply is exactly the end marker, which completes the run.

## 2025-08-26
- fix: reattach the uploaded book file on every turn so chat generation always includes the file reference; also send `systemInstruction` at top level.
- tests: add minimal Node tests for request builders to assert file part attachment and `systemInstruction` placement.
- docs: update WORKFLOW turn structure to state the file is reattached each turn (aligns with README/UI text).

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
