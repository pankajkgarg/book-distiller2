# Distiller Workflow and Error Handling

This document is the authoritative description of how the app orchestrates provider calls, local source extraction, conversation history, and retries. If related code changes, update this file in the same PR.

## Overview

- Frontend stack: Petite‑Vue app (`app.js`) with provider adapters (`providers.js`) and browser extractors (`extractors.js`).
- Providers:
  - `Google AI Studio`
  - `OpenRouter`
- Source modes:
  - `Native file`
  - `Extracted text`
- Supported source files:
  - PDF
  - EPUB

## Setup and Persistence

- Provider persists in `localStorage` under `distillboard.provider`.
- Source mode persists under `distillboard.source_mode`.
- API keys are stored per provider in `distillboard.provider_keys`.
- Legacy `distillboard.gemini_key` is migrated into the Google AI Studio slot on startup.
- Saved key entries are normalized to `{ label, key, provider, created }`.
- The distillation prompt persists under `distillboard.prompt`.
- Temperature is only included when the toggle is enabled.
- Auto wait, theme, and model selection also persist.

## Local Source Analysis

The app always tries to analyze the uploaded file locally after selection, even if the eventual run uses `Native file`.

### PDF

- Parsed in the browser with PDF.js.
- Text is extracted page-by-page.
- Output preserves light page separators (`--- Page N ---`).

### EPUB

- Parsed in the browser by unpacking the EPUB container and reading the spine documents.
- XHTML/HTML chapter files are flattened into readable text.
- Output preserves chapter separators (`--- Chapter N ---`).

### Analysis Result Shape

`extractedSource` is either `null` or:

- `kind`: `pdf` | `epub`
- `text`
- `wordCount`
- `tokenEstimate`
- `charCount`
- `pageCount` when available
- `chapterCount` when available
- `warnings`

### Counts

- `wordCount`: best-effort count of normalized word-like tokens
- `tokenEstimate`: approximate `Math.ceil(text.length / 4)`

If local extraction fails:

- counts render as unavailable
- Google native mode may still run
- extracted-text mode remains blocked until extraction succeeds

## Provider-Specific Source Handling

### Google AI Studio

#### Native file

1. Upload file through the Gemini Files API.
2. Poll every 2s until the file leaves `PROCESSING`.
3. If the file reaches `FAILED`, pause the run with an error.
4. First turn includes the uploaded file part plus the opening instruction.
5. Subsequent turns send `"Next"` while preserving history.

#### Extracted text

1. Skip Files API upload entirely.
2. First turn sends the extracted source text plus the opening instruction.
3. Subsequent turns send `"Next"` with prior history.

### OpenRouter

#### Native file

- Allowed only for PDF and only when the selected model exposes `file` input support.
- First turn sends:
  - opening instruction text
  - `file` content part with a base64 data URL
- To avoid resending the base64 PDF on every future turn, the stored first-turn history is replaced with extracted text when local extraction is available.

#### Extracted text

- First turn sends extracted source text plus the opening instruction.
- Subsequent turns send `"Next"` with prior history.

## Model Loading

### Google AI Studio

- Uses a curated static model list:
  - `gemini-3-pro-preview`
  - `gemini-2.5-pro`
  - `gemini-2.5-flash`
  - `gemini-2.5-flash-lite`

### OpenRouter

- Loads models dynamically from `https://openrouter.ai/api/v1/models`.
- Filters to text-capable models.
- In `Native file` mode, further filters to file-capable models.
- Sorts with file-capable models first when relevant, then by context length, then by label.

If the current model becomes invalid after provider/source-mode changes, the app picks a valid fallback automatically.

## Run Validation

Before `start()`:

- missing API key → blocked
- missing file → blocked
- empty prompt → blocked
- extracted-text mode without completed local extraction → blocked
- OpenRouter native mode with EPUB → blocked
- OpenRouter native mode with non-file-capable model → blocked

## Turn Structure

### First turn

- Sends the opening instruction:
  - "Begin as instructed: include Opening the Journey (intro, architecture, reading guide) and the first complete thematic section."
- Source attachment depends on provider and source mode, as described above.

### Subsequent turns

- Single user message with `"Next"`.
- Full request history is rebuilt each turn from the app’s stored message history.

## History Rules

- History is only mutated after successful model responses.
- Failed turns do not append user/model messages.
- The live document is derived from `sectionsMeta`, not raw provider history.
- Deleting a section removes its model message from history and removes its prior user `"Next"` message when applicable.

## Error Handling and Retries

- `429` and `5xx`:
  - fixed 60s wait
  - visible countdown
  - maximum 4 automatic attempts before pausing
- Other transient conditions:
  - exponential backoff with jitter
  - Retry‑After / RetryInfo honored when present
- Non-transient errors:
  - pause the run
  - surface `lastErrorMessage`
  - log request/error metadata in `trace`

If the app is paused while waiting to retry, the in-flight operation aborts and no history mutation occurs for that failed turn.

## Google Native Source Recovery

Symptoms:

- `FAILED_PRECONDITION`
- messages containing `Unsupported file uri`

Handling:

1. Re-upload the original file once.
2. Rewrite prior Google file parts in history to use the new URI.
3. Retry the request unchanged.

This recovery logic is Google-only.

## Pausing and Completion

- Completion:
  - when the latest assistant text ends with the configured end marker
- Anomaly pauses:
  - likely refusal phrasing
  - very short non-code output (`< 200` chars), unless the text ends with the end marker; retried up to 5 times (60s waits) before pausing
  - artifact leaks (`<ctrl94>`); same retry-then-pause behavior
  - high similarity to the prior assistant response (`> 0.9` trigram similarity)
- Every pause (user pause, refusal, loop, anomaly, error) keeps the run resumable: Resume continues from the existing history instead of restarting.
- Budgets:
  - time budget → stop with `time budget reached`
  - estimated token budget → stop with `token budget reached (est)`

## Trace and Export

- `trace` stores request/response/error payloads and retry counts.
- Trace can be downloaded as JSON.
- Export metadata includes provider and source mode in addition to model, temperature, sections, and date.

## Edge Cases

- offline browser state is treated as transient
- malformed local files can fail extraction while native Google mode still works
- OpenRouter model fetch failure leaves no dynamic model list for OpenRouter until refresh succeeds
- changing provider or source mode can invalidate the selected model
- end marker is matched as a plain text suffix; a response that is only the end marker counts as completion, not a short-output anomaly
- token estimation is approximate only

## Maintenance

If you change any of the following, update this document and reference the change in `CHANGELOG.md`:

- provider selection or request shape
- source-mode behavior
- local extraction rules
- retry/backoff logic
- history semantics
- completion or pause criteria
