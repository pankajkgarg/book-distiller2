# Changelog

All notable changes to this project will be documented in this file.

## 2025-08-19
- Refactor: extracted Gemini SDK wiring and retry/backoff logic into a new `gemini.js` service.
- app state remains in `app.js`; it now delegates API calls to `gemini.js`.
- Behavior preserved; retry UI (spinner/countdown) still updates via service callbacks.
- Sets groundwork for swapping providers or models with a thin service layer.

