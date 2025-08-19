# Changelog

All notable changes to this project will be documented in this file.

## 2025-08-19
- Refactor: extracted Gemini SDK wiring and retry/backoff logic into a new `gemini.js` service.
- app state remains in `app.js`; it now delegates API calls to `gemini.js`.
- Behavior preserved; retry UI (spinner/countdown) still updates via service callbacks.
- Sets groundwork for swapping providers or models with a thin service layer.

- Feat: updated model options to `gemini-2.5-pro`, `gemini-2.5-flash`, and `gemini-2.5-flash-lite`; normalized default to allowed set.
- UI: widened model dropdown for readability; modernized file chooser button; display a rough token estimate (size/4) after upload.
- Docs: linked `CHANGELOG.md` from README and added Pages deployment instructions.
- CI: added GitHub Actions workflow to publish to GitHub Pages on push to `main`.
- Fix: explicitly send empty `tools` array in Gemini requests to avoid Google Search grounding.
