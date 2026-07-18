# Notes

## Overview
Static client-side book distillation app. Uploads PDF/EPUB, can extract text locally in the browser or use provider-native file handling, and distills content iteratively. No backend. Deployed on GitHub Pages.

## Current status
[2026-07-10] Working. The density-aware prompt optimization and full three-section GPT-5.6 comparison are complete. On 21,164 raw source words, Sol/Codex produced 9,088 words (42.9%); Luna/Codex 6,740 (31.8%); Luna/OpenRouter 6,983 (33.0%). A strengthened full-paragraph-excerpt Luna/Codex rerun produced 7,162 words (33.8%) with 5/6 exact quote groups, but still omitted a Chapter 2 excerpt and required three turns, showing that prompt-only excerpt enforcement is unreliable. Results are in `docs/prompt-optimization/results.md`; artifacts are under `temp/prompt_optimization/`. The recommended next design is deterministic excerpt selection followed by Luna weaving and evaluator gating. Vitest is green (28 tests). `src/` remains alternate/non-primary.

## Architecture
- Decision: Keep deployment static and browser-first. Why: shipped app must run on GitHub Pages with no backend. See log [2026-04-20].
- Decision: Root app lives in `index.html`, `app.js`, `core.js`, `providers.js`, and `extractors.js`. Why: that is the deployed product surface. See log [2026-04-20].
- Decision: Treat `src/` as alternate/non-primary UI. Why: avoid splitting active behavior across two app stacks by accident. See log [2026-04-20].
- Decision: Run local extraction even when `Native file` is selected. Why: counts, extracted-text fallback, and smaller OpenRouter history. See log [2026-04-20].
- Decision: Do not resend large native-file payloads on iterative OpenRouter turns when extracted text exists. Why: payload size and repeated upload cost. See log [2026-04-20].
- Decision: Enable OpenRouter Claude prompt caching by default with the standard 5-minute TTL. Why: cache refreshes on use and is cheaper than 1-hour for continuous book continuation loops. See log [2026-05-17].
- Decision: Keep `docs/WORKFLOW.md` as runtime-flow reference. Why: retries, provider behavior, and source handling need one authoritative doc. See log [2026-04-20].

## Invariants & gotchas
- Do NOT reattach file on turns 2+; history context carries it
- Book summary/distillation runs must preserve the project prompt (`temp/summarizer_prompt.md`) unless the user explicitly asks for a different prompt; model/provider changes are transport-only
- CDN-loaded libs: Petite-Vue, `@google/genai`, PDF.js, `fflate`, Marked, jsPDF — no npm equivalents assumed
- API key stored in localStorage only; never sent to any backend
- Search tools explicitly omitted from requests
- OpenRouter native mode is PDF-only; EPUB requires `Extracted text`
- OpenRouter Claude runs should carry `cache_control: { type: "ephemeral" }` by default; use `ttl: "1h"` only for expected >5 minute gaps between turns
- If Vitest fails with Rollup native `ERR_DLOPEN_FAILED` or code-signature errors, treat that as local environment state first, not proof of app breakage
- E2E model stubs must use clock-relative `created` dates (`monthsAgoUnixSeconds`); absolute dates rot against the 12-month recency filter
- OpenRouter attribution header is `X-Title` (plus `HTTP-Referer`), not `X-OpenRouter-Title`

## Conventions
- Read `NOTES.md` in full at session start; inspect `log.md` with `grep`/`tail`, never full-file scans
- Append `log.md` entries as events happen; do not rewrite old entries
- Update `CHANGELOG.md` for user-facing UI, behavior, configuration, docs, or CI changes
- Update `README.md` when setup, deployment, or user-facing flows change
- Use `scripts/codex-book-summary.mjs` (aka `book-distill` after `npm link`) for headless summary runs; it extracts PDF/EPUB/TXT/MD to Markdown before Codex CLI or OpenRouter continuation. Chat-completions runs default to no `max_tokens`; add `--max-output-tokens` only when intentionally capping output.
- CLI prompt resolution: `--prompt` → `temp/summarizer_prompt.md` in cwd → built-in `DEFAULT_PROMPT` from `core.js` (shared with the browser app); the script now imports `../core.js`, so it is not copy-standalone anymore.
