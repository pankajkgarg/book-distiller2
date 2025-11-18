# Distiller Workflow and Error Handling

This document is the authoritative description of how the app orchestrates Gemini calls, manages conversation state, and handles errors. If you change related code paths, update this document in the same PR.

## Overview

- Frontend stack: Petite‑Vue app (`app.js`) + a thin Gemini service wrapper (`gemini.js`).
- Models: `gemini-3-pro-preview`, `gemini-2.5-pro` (default), `gemini-2.5-flash`, `gemini-2.5-flash-lite`.
- The app uploads a book file (PDF/EPUB), then iterates sections by sending a first turn with the file and subsequent turns with only `"Next"`.

## Setup

- API key is stored in `localStorage` under `distillboard.gemini_key`.
- The system prompt is sent as `systemInstruction`. Temperature is applied only when the toggle is on.
- An empty `tools: []` is always sent to avoid search grounding.
- Optional auto spacing: enabling “Auto wait 60s between requests” enforces a 60-second countdown between completed turns before issuing the next Gemini call and surfaces a status bar while waiting.

## Upload and Processing

1) File is uploaded via Gemini Files API with exponential backoff. Transient errors honor Retry‑After/RetryInfo when provided.
2) The app polls the file status every 2s until it becomes `ACTIVE` or times out (~4 minutes).
3) If processing fails (`state === FAILED`), the run pauses with an error.

## Turn Structure

- First turn: A single user message that includes the uploaded file part and an instruction to produce the opening and first section.
- Subsequent turns: A single user message with only `"Next"`. The file is not reattached.
- Conversation context: Each request includes the full prior `history` so Gemini retains context, including the original file reference from the first turn.

## Error Handling and Retries

- 429 and 5xx: Automatically retried with a fixed 60s wait and visible countdown, up to 5 attempts. After 5 failed attempts, the run pauses and shows a Resume button.
- Other transient conditions (Retry‑After/RetryInfo/network/offline): Automatically retried with exponential backoff + jitter. UI shows attempt and countdown.
- Non‑transient errors: The app pauses the run with status `paused (error)`, surfaces `lastErrorMessage`, and logs the failing request/error in `trace`.
- Abort semantics: If paused while waiting to retry, the in‑flight operation aborts; no history mutations are made for the failed turn.

## Invalid File Reference Recovery

Symptoms
- Errors like `FAILED_PRECONDITION` or messages containing “Unsupported file uri”.

Handling
- Re‑upload the original file once.
- Rewrite any prior user message file parts in `history` to point to the new `uploadedFile.uri` (both `fileData` and legacy `file_data` shapes are supported).
- Retry the request with unchanged user content (still just `"Next"`).

Rationale
- Later turns omit the file; the original file reference embedded in history must remain valid for Gemini to access content.

## Pausing and Completion

- Completion: When the latest assistant text ends with the end marker (default `<end_of_book>`), status becomes `complete`.
- Anomaly Pauses (configurable):
  - Refusal phrasing → `paused (refusal)`.
  - Very short non‑code output (< 200 chars) → `paused (empty/short)`.
  - High similarity to prior assistant message (> 0.9 trigram sim) → `paused (loop)`.
- Budgets:
  - Time budget (seconds) → stop with `time budget reached`.
  - Token budget (rough length/4 estimate) → stop with `token budget reached (est)`.

## State and History Rules

- `history` is only appended on successful model responses. Failing turns do not mutate history.
- `history`, `sections`, and the live document reset only on a new `start()`.
- `trace` records every turn or error with request/response/error metadata and retry count; it can be downloaded.

## User Controls

- Start: Validates key, file, and prompt; uploads file; performs first turn.
- Pause/Resume: Toggles the iterative loop. Resume continues immediately with `"Next"`.
- Stop: Halts the loop and sets status to `stopped`.
- Exports: Copy combined text; export Markdown/TXT; export PDF (optionally appending `trace`).

## Edge Cases

- Network offline → treated as transient; retried until pause/stop.
- RetryInfo/Retry‑After headers are honored when provided; fallback is exponential backoff with jitter.
- Long file processing → polled up to ~4 minutes; errors out afterward.
- First turn failure → no history yet; fix conditions and resume to retry.
- Re‑upload failure during invalid‑URI handling → pause with error; history remains unchanged.
- End marker is used as a regex suffix; choose markers without special regex chars unless intended.
- Token estimation is approximate (length/4).
- Changing models mid‑run is not recommended; model setting persists for the next run.

## Maintenance: Keep This Doc Updated

- If you change:
  - Turn structure (e.g., reattaching files, prompt shape)
  - Retry/backoff or transient detection
  - Invalid file recovery logic
  - Pause/stop/completion criteria or budgets
  - State/history semantics
  …then update this document and reference the PR in `CHANGELOG.md`.
