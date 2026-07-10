# log

## [2026-04-19 00:00] status | bootstrapped NOTES.md + log.md
Created from codebase state. No prior IMPLEMENTATION_NOTES.md existed.

## [2026-04-20 11:43] note | correct bootstrap note
Correction: `IMPLEMENTATION_NOTES.md` did exist in this checkout when notes files were added. Keeping append-only history; not rewriting the earlier entry.

## [2026-04-20 11:43] refactor | retire IMPLEMENTATION_NOTES.md
Moved durable project memory into `NOTES.md` and `log.md`, promoted lasting architecture and gotchas into `NOTES.md`, and retired the legacy file from the active root layout.

## [2026-05-16 16:36] note | codex headless summary from PDF markdown
PDF-native `codex exec` was not equivalent to API file upload; CLI only had local extraction tools. Extracted `temp/The_First_90_Days_First_3_Sections.pdf` to Markdown with PDF.js, then generated `temp/The_First_90_Days_First_3_Sections.summary.md` via `codex exec -m gpt-5.5` continuation until `<end_of_book>`.

## [2026-05-16 16:57] fix | reusable headless summary script
Added `scripts/codex-book-summary.mjs` to extract PDF/EPUB/TXT/MD to Markdown, run `codex exec -m gpt-5.5`, and resume with `continue` until `<end_of_book>`. Verified help plus PDF/TXT extract-only paths.

## [2026-05-16 16:58] decision | document headless summary convention
Promoted the reusable script path into `NOTES.md` conventions so future sessions use local Markdown extraction before `codex exec` for book summaries.

## [2026-05-16 17:15] fix | EPUB summary token reporting
Improved `scripts/codex-book-summary.mjs` EPUB chapter naming from NCX/nav metadata and added explicit book-token estimates plus per-turn Codex usage reporting. Generated `temp/books/show_your_work_austin_kleon.summary.md` in 3 turns ending with `<end_of_book>`.

## [2026-05-16 18:08] fix | translated summary filename support
Added `--language` and `--lang-code` to `scripts/codex-book-summary.mjs`; summaries now write as `<Book Name> - summary - <lang>.markdown`, with matching usage reports. Copied Show Your Work outputs to the new `- en.markdown` naming convention.

## [2026-05-16 18:09] note | document translated summary outputs
Synced README and CHANGELOG with the `.markdown` output naming and `--language` translated-summary support.

## [2026-05-16 18:10] fix | switch summary extension to md
Changed headless output names from `.markdown` to `.md` for extracted, summary, and usage Markdown files; README and CHANGELOG now document the `.md` convention.

## [2026-05-16 18:45] experiment | Hindi first-chunk summary sample
Ran `scripts/codex-book-summary.mjs` on Show Your Work with `--language Hindi --lang-code hi --max-parts 1`. Produced first chunk at `temp/books/Show Your Work! 10 Ways to Share Your Creativity and Get Discovered - summary - hi.md`; stopped without `<end_of_book>` as expected.

## [2026-05-16 19:16] fix | stricter Hindi translation override
Moved translated-summary language rules after the supplied summarizer prompt and added Hindi-specific no-Hinglish constraints plus language-aware continuation prompts. Regenerated Show Your Work Hindi sample; corrected Unicode word counting for Hindi usage reports.

## [2026-05-16 19:23] fix | Hindi glossary discourages transliteration
Expanded Hindi override with explicit term mappings such as network/contact-jal, project/pariyojana, and blog/lekh-manch. Regenerated Show Your Work Hindi sample in one turn with `<end_of_book>` and no hits for the original mixed-English failure phrase.

## [2026-05-16 19:25] fix | simplify translated-summary language suffix
Replaced the Hindi-specific glossary with a two-line generic final language instruction appended after the extracted source. Continuation prompts now carry only a short generic language reminder.

## [2026-05-16 20:10] experiment | Hindi two-turn language sample
Generated a forced two-turn Hindi sample for Show Your Work using `temp/hindi_two_turn_sample_prompt.md` and lang code `hi-2turn-sample`. Turn 1 stopped without `<end_of_book>`; turn 2 finished with the marker.

## [2026-05-16 20:14] fix | namespaced EPUB OPF parsing
Patched `scripts/codex-book-summary.mjs` to recognize namespace-prefixed XML tags like `<opf:item>` and `<opf:itemref>`. Verified `The_Dry_-_Jane_Harper.epub` extract-only succeeds with 51 entries and writes `temp/books/The Dry - extracted.md`.

## [2026-05-17 06:53] fix | OpenRouter headless provider
Added `--provider openrouter` to `scripts/codex-book-summary.mjs`, defaulting OpenRouter to `deepseek/deepseek-v3.2`, plus `--list-openrouter-models`. Verified DeepSeek V3.2 model ids via OpenRouter `/models`; actual generation requires `OPENROUTER_API_KEY`.

## [2026-05-17 08:02] experiment | First 90 Days OpenRouter free smoke blocked
Copied `The_First_90_Days_First_3_Sections.pdf/.txt` from Downloads to `temp/` and extracted the PDF to Markdown. Selected `deepseek/deepseek-v4-flash:free`; generation is blocked because `OPENROUTER_API_KEY` is not set in the shell.

## [2026-05-17 08:17] experiment | First 90 Days OpenRouter free smoke succeeds
Loaded `OPENROUTER_API_KEY` from `../vendingbench_stocks/.env` without printing it and ran one OpenRouter turn using `deepseek/deepseek-v4-flash:free`. Wrote `temp/The First 90 Days, Updated and Expanded Proven Strategies for Getting Up to Speed Faster and Smarter - summary - en-openrouter-free-test.md`; fixed OpenRouter max-output option to send `max_tokens`.

## [2026-05-17 08:42] fix | language suffix only for non-English
Stopped a lingering OpenRouter V3.2 test process and changed `scripts/codex-book-summary.mjs` so English runs do not append any language suffix. Non-English runs still get the short final language instruction.

## [2026-05-17 09:04] fix | source boundary for headless summaries
Added one wrapper line telling models to use only the supplied extracted Markdown and not infer, invent, or summarize material outside it. Verified script syntax.

## [2026-05-17 09:05] fix | remove unrequested copyright wrapper
Removed the extra `Copyright guardrail` wrapper line from `scripts/codex-book-summary.mjs`; it was not requested and should not steer the user's summarizer prompt.

## [2026-05-17 09:10] fix | OpenRouter plain prompt shape
Changed OpenRouter headless prompts to plain user prompt plus extracted source and final suffixes only. Kept the Codex-specific wrapper for Codex provider runs; source and non-English language instructions are final suffixes.

## [2026-05-17 09:19] fix | prompt suffix before book source
Moved generated source-boundary and non-English language lines into the summarizer prompt before the extracted Markdown source. Verified with a local OpenRouter mock that no generated suffix is sent after the book text.

## [2026-05-17 09:45] experiment | First 90 Days DeepSeek V3.2 rerun
Ran body-only First 90 Days three-section sample through OpenRouter `deepseek/deepseek-v3.2` with 6000 max output tokens. Completed in 4 turns with `<end_of_book>`; usage report recorded 30246 estimated book tokens and 14140 reported output tokens.

## [2026-05-17 09:53] fix | headless retry and resume
Added OpenRouter per-call retries plus `--resume-run` checkpoint recovery from completed `part_###.md` files. Verified retry and resume behavior with a local mock OpenRouter server.

## [2026-05-17 11:17] fix | direct DeepSeek headless provider
Added `--provider deepseek` with dotenv key loading and direct Chat Completions calls. Verified a smoke test plus the First 90 Days body-only sample; direct DeepSeek finished in 5 turns with heavy cached input reuse.

## [2026-05-17 12:46] experiment | Sonnet 4.6 OpenRouter partial stop
Started body-only First 90 Days three-section sample through OpenRouter `anthropic/claude-sonnet-4.6` with 6000 max output tokens. User stopped during part 3; parts 1-2 are saved under `temp/codex_runs/the_first_90_days_first_3_sections_body_only_20260517_123851/`.

## [2026-05-17 12:49] fix | no default chat output cap
Changed headless OpenRouter/DeepSeek runs to omit `max_tokens` by default; `--max-output-tokens` is now opt-in and `--no-max-output-tokens` can override resumed capped runs. Updated README, CHANGELOG, and NOTES.

## [2026-05-17 13:02] experiment | The Dry Sonnet summary
Ran `/Users/pankaj/Downloads/The_Dry_-_Jane_Harper.epub` through OpenRouter `anthropic/claude-sonnet-4.6` with `temp/sonnet_summary_prompt.md`. Completed in 1 turn with `<end_of_book>`; wrote `temp/books/The Dry - summary - en.md` and usage report.

## [2026-05-17 13:26] fix | prompt fidelity rule for temp book runs
Added `temp/AGENTS.md` and promoted the invariant to `NOTES.md`: book runs must use `temp/summarizer_prompt.md` unless the user explicitly changes the prompt. Moved mistaken `temp/sonnet_summary_prompt.md` to `trash/mistaken_prompts_20260517/`.

## [2026-05-17 13:38] experiment | The Dry Sonnet original-prompt partial
Reran `/Users/pankaj/Downloads/The_Dry_-_Jane_Harper.epub` through OpenRouter `anthropic/claude-sonnet-4.6` using `temp/summarizer_prompt.md`. OpenRouter key total limit stopped part 4; correct-prompt partial saved as `temp/books/The Dry - summary - en-sonnet-original-prompt-PARTIAL.md`.

## [2026-05-17 18:39] fix | OpenRouter Claude prompt caching
Enabled top-level OpenRouter `cache_control` for Claude models with default 1h TTL in both headless and browser requests. Added `--openrouter-cache-ttl`, cache-write usage reporting, docs, temp AGENTS rule, and verified payload shape with a local mock.

## [2026-05-17 19:09] fix | default Claude cache TTL to 5m
Changed OpenRouter Claude default cache control from 1h to standard 5m after confirming cache refreshes on use. Kept `--openrouter-cache-ttl 1h` for expected long gaps; verified mock payload now sends `{ type: "ephemeral" }` without `ttl`.

## [2026-05-17 19:10] status | The Dry Sonnet partial coverage
Mapped the partial original-prompt Sonnet output to the Mrs Sullivan reaction in chapter nine. Coverage is about 22.6% by narrative words, or 23.0% by extracted-source bytes.

## [2026-07-10 08:55] status | branch status moved from NOTES
Prior undated NOTES status: root app working with both providers, source modes, browser extraction, and Playwright E2E; superseded by dated 2026-07-10 status.

## [2026-07-10 08:56] fix | branch review fixes and test pipeline
Reviewed codex/add-openrouter-and-pdf-parsing. Fixed: .env/temp/trash not gitignored; missing vitest dep and `npm test` script; stale retry banner after transient recovery; wrong `X-OpenRouter-Title` header; EPUB percent-encoded hrefs silently dropping chapters (browser + headless); headless EPIPE crash, `--retries 0` resume, `--codex-bin` persistence; time-rotted E2E stub dates. Added CI workflow and model-filter unit tests. Confirmed OpenRouter top-level `cache_control` is valid API.

## [2026-07-10 09:05] feat | book-distill first-class CLI
Promoted scripts/codex-book-summary.mjs to an installable CLI: `bin: book-distill` + shebang/exec bit, optional --prompt falling back to temp/summarizer_prompt.md then the built-in DEFAULT_PROMPT now exported from core.js (shared with browser app). Verified with a mock OpenRouter server from a clean cwd (built-in prompt used, 2 parts, end marker) and from repo root (temp/summarizer_prompt.md still wins). Unit + E2E suites green.
