# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

**Essential Commands:**
- `npm run dev` - Start Vite dev server with hot reload
- `npm run build` - Production build to `dist/`
- `npm run preview` - Preview built site locally
- `npm test` - Run unit tests with Vitest
- `npm run test:watch` - Vitest watch mode
- `npm run test:e2e` - Playwright E2E suite (mocked provider responses)
- `npm run test:e2e:headed` - Same suite in a headed browser
- `npm run test:e2e:real` - Real OpenRouter smoke test (needs `OPENROUTER_API_KEY`)
- `npm run book:summary -- --input <file>` - Headless book distillation CLI (`--prompt` optional: falls back to `temp/summarizer_prompt.md`, then the built-in `DEFAULT_PROMPT` from `core.js`); also installable as `book-distill` via `npm link`

**Testing:**
- `npm test -- tests/utils.test.js` - Run specific unit test file
- `npx playwright test tests/e2e/app.spec.js -g "<name>"` - Run one E2E test
- CI (`.github/workflows/ci.yml`) runs unit + mocked E2E on push/PR

## Architecture Overview

This is a client-side book distillation app built with Petite-Vue that iteratively extracts content from uploaded PDF/EPUB files via Google Gemini or OpenRouter.

### Core Architecture

**Module Layout (root static app is the deployed surface):**
- `app.js` - Petite-Vue app containing all UI state, workflow orchestration, and user interactions
- `core.js` - Pure helpers: storage, model normalization/filtering, text utilities (unit-tested, no DOM/network)
- `providers.js` - Provider adapters (Google AI Studio, OpenRouter) with retry logic and error handling
- `extractors.js` - Browser-side PDF (PDF.js) and EPUB (fflate + DOMParser) text extraction
- `scripts/codex-book-summary.mjs` - Headless CLI summary flow (Codex CLI, OpenRouter, or direct DeepSeek)
- `src/` - Alternate Vue app; NOT the primary deployment target

**Key Flow:**
1. User uploads book file → local extraction always runs (word/token stats, extracted-text source)
2. `Native file` mode: Google uploads via Files API; OpenRouter embeds PDF as base64 data URL (PDF only)
3. First turn: file/extracted text + system prompt; subsequent turns send ONLY "Next"
4. App continues until end marker (`<end_of_book>`) or user stops

See `docs/WORKFLOW.md` for the authoritative runtime flow, retries, and provider behavior.

### Critical State Management

**Conversation State:**
- `history[]` - Full conversation context (user/model messages, provider-specific shapes)
- `sectionsMeta[]` - UI metadata for each generated section with deletion capability
- Google file references in history must remain valid across turns

**Error Recovery:**
- Invalid Google file URI (`FAILED_PRECONDITION`) → re-upload and update all history file references
- Transient errors (429, 5xx) → fixed 60s waits, max 4 attempts, then pause
- Content anomalies → detect short responses, refusals, loops, artifact leaks

### Testing Architecture

- `tests/*.test.js` - Vitest unit tests over `core.js` pure functions (no mocks needed; jsdom env)
- `tests/e2e/app.spec.js` - Playwright E2E with stubbed OpenRouter `fetch`; model `created` stamps must stay relative to the clock (see `monthsAgoUnixSeconds`)
- `tests/e2e/openrouter.real.spec.js` - Live OpenRouter smoke, self-skips without `OPENROUTER_API_KEY`
- Playwright starts its own Vite server; set `PW_REUSE_EXISTING_SERVER=true` to reuse a running one

## Important Implementation Details

**Turn Structure (Critical):**
- First turn MUST include the source (file part or extracted text) + instruction
- Subsequent turns send ONLY "Next" - do NOT reattach the source
- OpenRouter history persists extracted text instead of the base64 file when available (payload size)

**OpenRouter specifics:**
- Model list is fetched live, filtered to text-capable models added in the last 12 months
- Native file mode is PDF-only and requires a file-capable model
- Claude models (`anthropic/claude-*`) get top-level `cache_control: { type: "ephemeral" }` (valid OpenRouter API for automatic Anthropic prompt caching)

## Documentation Requirements

When making changes, update these files:
- `CHANGELOG.md` - All user-facing changes (use conventional commit format)
- `README.md` - UI/UX changes, deployment, configuration changes
- `docs/WORKFLOW.md` - Changes to turn structure, retry logic, error handling, or state management
- `NOTES.md` / `log.md` - Per the memory protocol in AGENTS.md

## Key External Dependencies

- **CDN-loaded libraries:** Petite-Vue, @google/genai, PDF.js, fflate, marked.js, jsPDF
- **Runtime:** Pure client-side, no backend required
- **Deployment:** Static site via GitHub Pages
- **Storage:** localStorage for API keys, settings, prompts (never sent to any backend)
