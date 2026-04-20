# Notes

## Overview
Static client-side book distillation app. Uploads PDF/EPUB, can extract text locally in the browser or use provider-native file handling, and distills content iteratively. No backend. Deployed on GitHub Pages.

## Current status
Working. Root static app is the active product surface and supports Google AI Studio plus OpenRouter, with `Native file` and `Extracted text` source modes, browser-side PDF/EPUB analysis, and Playwright E2E coverage. `src/` contains an alternate Vue app and is not the primary deployment target.

## Architecture
- Decision: Keep deployment static and browser-first. Why: shipped app must run on GitHub Pages with no backend. See log [2026-04-20].
- Decision: Root app lives in `index.html`, `app.js`, `core.js`, `providers.js`, and `extractors.js`. Why: that is the deployed product surface. See log [2026-04-20].
- Decision: Treat `src/` as alternate/non-primary UI. Why: avoid splitting active behavior across two app stacks by accident. See log [2026-04-20].
- Decision: Run local extraction even when `Native file` is selected. Why: counts, extracted-text fallback, and smaller OpenRouter history. See log [2026-04-20].
- Decision: Do not resend large native-file payloads on iterative OpenRouter turns when extracted text exists. Why: payload size and repeated upload cost. See log [2026-04-20].
- Decision: Keep `docs/WORKFLOW.md` as runtime-flow reference. Why: retries, provider behavior, and source handling need one authoritative doc. See log [2026-04-20].

## Invariants & gotchas
- Do NOT reattach file on turns 2+; history context carries it
- CDN-loaded libs: Petite-Vue, `@google/genai`, PDF.js, `fflate`, Marked, jsPDF — no npm equivalents assumed
- API key stored in localStorage only; never sent to any backend
- Search tools explicitly omitted from requests
- OpenRouter native mode is PDF-only; EPUB requires `Extracted text`
- If Vitest fails with Rollup native `ERR_DLOPEN_FAILED` or code-signature errors, treat that as local environment state first, not proof of app breakage

## Conventions
- Read `NOTES.md` in full at session start; inspect `log.md` with `grep`/`tail`, never full-file scans
- Append `log.md` entries as events happen; do not rewrite old entries
- Update `CHANGELOG.md` for user-facing UI, behavior, configuration, docs, or CI changes
- Update `README.md` when setup, deployment, or user-facing flows change
