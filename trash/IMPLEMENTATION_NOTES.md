# Implementation Notes

**Purpose**: Persistent implementation memory for this repository.

**CRITICAL INSTRUCTION FOR AI AGENTS**:
1. Read this file in full at the start of every session.
2. After context compaction, re-read this file immediately.
3. Update this file with new decisions and discovered constraints.
4. Record why changes were made, not just what changed.

---

## Project Overview

- Static GitHub Pages app for long-form book distillation.
- Runtime is browser-first: no backend required.
- Root static app is the active product surface.
- `src/` contains an alternate Vue app and is not the primary deployment target.

## Current Status

- Multi-provider support added at the root app layer:
  - `Google AI Studio`
  - `OpenRouter`
- Source modes added:
  - `Native file`
  - `Extracted text`
- Browser-side source analysis added for PDF and EPUB.

## Architecture Decisions

- Keep deployment static. Do not introduce Python-only preprocessing into the shipped app.
- Treat `pdfplumber` as an extraction-quality reference, not a runtime dependency.
- Replace `epub2txt2` with browser EPUB parsing to preserve portability.
- Keep provider orchestration in root static modules:
  - `core.js`
  - `providers.js`
  - `extractors.js`
  - `app.js`

## Implementation Details

- `core.js`
  - storage migration
  - model normalization/sorting helpers
  - provider/source-mode constants
  - shared text/count utilities
- `providers.js`
  - provider adapters
  - shared retry helpers
  - Google Files API upload/poll flow
  - OpenRouter chat completions flow
- `extractors.js`
  - PDF.js extraction
  - EPUB unzip + spine traversal
- `app.js`
  - Petite‑Vue state
  - source analysis lifecycle
  - provider-aware request loop

## Discovered Patterns

- OpenRouter native file mode is impractical to resend as base64 on every iterative turn.
- To reduce repeated payload size, the app stores extracted text as the persistent first-turn history for OpenRouter native mode when local extraction is available.
- Local extraction should run even when the user chooses native mode, because:
  - it enables counts
  - it enables extracted-text fallback
  - it reduces future OpenRouter history size

## Known Issues & Solutions

- Vitest currently fails in this checkout because the local Rollup native dependency cannot load (`ERR_DLOPEN_FAILED` / code-signature mismatch).
- Syntax checks succeeded with the bundled Node runtime, but full Vitest execution is presently blocked by environment state rather than app code.

## Performance Notes

- PDF extraction runs page-by-page in-browser and can be slow on large books.
- EPUB extraction is zip/DOM heavy but stays client-side.
- Dynamic OpenRouter model loading happens on provider/source-mode changes; keep it lightweight.

## TODO & Next Steps

- Consider a stronger token estimator if the lightweight `chars / 4` heuristic becomes misleading.
- Consider progressive extraction progress UI for very large books.
- Consider a provider/model cache for OpenRouter to reduce repeated model fetches.

## Session Log

### 2026-04-19

- Added multi-provider support plan implementation in the root static app.
- Added browser-side PDF/EPUB extraction and local word/token stats.
- Added provider-scoped API key persistence and legacy Gemini key migration.
- Updated README, workflow docs, changelog, and added this implementation notes file.

### 2026-04-20

- Added Playwright E2E coverage under `tests/e2e/`.
- Added fixture-backed browser tests for:
  - PDF extraction stats
  - EPUB extraction stats
  - OpenRouter native EPUB validation
  - provider/source-mode model refresh
- Added a real OpenRouter smoke test that:
  - loads the provided key from `OPENROUTER_API_KEY`
  - runs `OpenRouter` + `Extracted text`
  - uploads the tiny EPUB fixture
  - waits for the first rendered section, then stops cleanly
- Learned: the real smoke spec is more reliable when it opens settings explicitly and drives provider/source-mode through the UI instead of assuming saved hidden state.
