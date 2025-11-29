# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

**Essential Commands:**
- `npm run dev` - Start Vite dev server with hot reload
- `npm run build` - Production build to `dist/`
- `npm run preview` - Preview built site locally
- `npm test` - Run all tests with Vitest
- `npm run test:ui` - Interactive test interface

**Testing:**
- `npm test -- tests/utils.test.js` - Run specific test file
- `npm test -- --watch` - Watch mode for development

## Architecture Overview

This is a client-side book distillation app built with Petite-Vue that uses Google Gemini to iteratively extract content from uploaded PDF/EPUB files.

### Core Architecture

**Two-Layer Design:**
- `app.js` - Petite-Vue app containing all UI state, workflow orchestration, and user interactions
- `gemini.js` - Thin service layer that wraps Google Gemini SDK with retry logic and error handling

**Key Flow:**
1. User uploads book file → Gemini Files API processes it
2. First turn: File + system prompt sent to Gemini 
3. Subsequent turns: Only "Next" sent (file reference preserved in history)
4. App continues until end marker (`<end_of_book>`) or user stops

### Critical State Management

**Conversation State:**
- `history[]` - Full conversation context (user/model messages)
- `sectionsMeta[]` - UI metadata for each generated section with deletion capability
- File references in history must remain valid across turns

**Error Recovery:**
- Invalid file URI → re-upload and update all history file references
- Transient errors (429, 5xx) → auto-retry with fixed 60s waits (max 4 attempts)
- Content anomalies → detect short responses, refusals, loops, artifact leaks

### Testing Architecture

**Test Structure:**
- `tests/utils.test.js` - Pure utility functions (sim3, stripMd, estimateTokens)
- `tests/gemini.test.js` - Service layer retry logic, error detection, text extraction
- `tests/app.test.js` - State management, file handling, export functions

**Mocking Strategy:**
- External dependencies (Petite-Vue, Gemini SDK) are mocked
- Browser APIs (localStorage, document, navigator) are mocked in test globals
- File objects use plain objects instead of actual File constructor

## Important Implementation Details

**Turn Structure (Critical):**
- First turn MUST include uploaded file part + instruction
- Subsequent turns send ONLY "Next" - do NOT reattach file
- Full history context preserves original file reference

**Retry Behavior:**
- 429/5xx errors: Fixed 60s retry, max 4 attempts, then pause
- Other transient: Exponential backoff with jitter
- Content quality checks run on every response (length, similarity, artifact detection)

**File Reference Recovery:**
- When `FAILED_PRECONDITION` occurs, re-upload file once
- Update ALL prior history entries with new file URI (both `fileData` and `file_data` formats)

## Documentation Requirements

When making changes, update these files:
- `CHANGELOG.md` - All user-facing changes (use conventional commit format)
- `README.md` - UI/UX changes, deployment, configuration changes
- `docs/WORKFLOW.md` - Changes to turn structure, retry logic, error handling, or state management

## Key External Dependencies

- **CDN-loaded libraries:** Petite-Vue, @google/genai, marked.js, jsPDF
- **Runtime:** Pure client-side, no backend required
- **Deployment:** Static site via GitHub Pages
- **Storage:** localStorage for API keys, settings, prompts
