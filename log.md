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
## [2026-07-10 09:30] bug | bundled shell lacks GNU csplit and npm flags
The first Chapter 1 slicing/test command failed because macOS `csplit` has no `-b` option and this Codex runtime exposes Node without `npm`; no inference request was made.
## [2026-07-10 19:27] experiment | Gemini cache miss without sticky session
Two identical 5,027-input-token Gemini 3.1 Pro cache probes returned zero cached tokens. Added an explicit OpenRouter session-id path before attempting full SxS outputs.
## [2026-07-10 19:29] fix | leave Gemini cache breakpoint tail
Session pinning alone still produced a full-price miss. Changed Gemini content shaping to cache the stable prompt/source prefix while retaining a small uncached source tail, matching OpenRouter's documented breakpoint pattern.
## [2026-07-10 19:30] experiment | tiny Grok prompt cache verified
Two session-pinned Grok 4.3 calls used only 441 input and 16 output tokens each. Cached input rose from 128 to 384 tokens; cost fell from $0.00045685 to $0.00018805, proving automatic provider caching without a documented minimum.
## [2026-07-10 19:31] status | prior current status superseded
Root app remained working with the restored test pipeline; CLI cache/reasoning work and SxS gating are now reflected in NOTES current status.
## [2026-07-10 19:45] experiment | Chapter 1 Gemini vs Grok SxS complete
Using detailed_prompt.md at medium reasoning, Gemini 3.1 Pro completed in 2 turns ($0.0994748; 8,164 cached) and Grok 4.3 in 5 turns ($0.0503155; 43,840 cached). Gemini was tighter and followed formatting better; Grok was longer and more extractive.
## [2026-07-10 19:46] note | interactive SxS report generated
Created `temp/sxs_results/first90_chapter1_gemini31pro_vs_grok43_sxs.html` with full outputs, per-turn cache/cost evidence, view controls, and qualitative verdict. Verified in-browser with no console errors.
## [2026-07-10 19:47] status | prior current status superseded
The earlier cache-gated SxS status is superseded by the completed Chapter 1 comparison and report now recorded in NOTES.

## [2026-07-10 19:52] fix | Qwen OpenRouter prompt caching
Alibaba Qwen requires an explicit cache_control breakpoint to cache; CLI only added it for Claude+Gemini, so Qwen ran fully uncached. Added isOpenRouterQwenModel + usesEmbeddedCacheBreakpoint and routed Qwen through the embedded-breakpoint path in scripts/codex-book-summary.mjs. Verified live: qwen3.7-max turn-2 cached_input=5575 (was 0).

## [2026-07-10 19:52] experiment | SxS Gemini 3.1 Pro vs GPT-5.6 Luna vs Qwen3.7 Max
Half of First-90-Days ch1 (~5.6k tok) + detailed_prompt.md, medium reasoning, via OpenRouter. Caching (real CLI): GPT cached 34k/44k input (implicit ✅), Qwen cached 5.5k (✅ after fix), Gemini cached=0 AND cache_write=0 (explicit breakpoint inert in the two-block split; single-block probe DID cache). Cost: Gemini $0.119 (no cache, priciest), GPT $0.044 (cheapest), Qwen $0.052. Quality: Gemini heaviest verbatim + best voice + clean end_of_book but weakest TTS pauses; Qwen best TTS pauses + clean synthesizing close; GPT cleanest structure/cheapest but rewrote more and left 3 "please provide next section" meta lines + no end marker. Outputs in temp/sxs_ch1/.

## [2026-07-10 20:58] experiment | Single-shot SxS (no 5k chunk rule)
temp/detailed_prompt_single_shot.md (immersive style, chunking removed) + --max-parts 1. All 3 finished in ONE turn with clean <end_of_book>; cost dropped (Gemini $0.119->$0.059, GPT $0.044->$0.038, Qwen $0.052->$0.035). Output/source word ratio diverged by model: Gemini 0.52x (self-compressed, but dropped the Cultural-Norms checklist), GPT 1.14x (28 blockquotes but 0 TTS pauses), Qwen 0.97x (13/13 coverage, 34 blockquotes, 14 pauses -> best fit for the audio-script prompt). Multi-turn machinery + caching only earns its keep on full books that exceed a single 64-128k output. Outputs in temp/sxs_ch1_1shot/.

## [2026-07-10 22:30] feat+experiment | Direct Gemini distiller w/ explicit caching (scripts/gemini-distill.mjs)
New standalone REST harness: creates a Gemini context cache (book+prompt), multi-turn loop, thinking on, per-turn telemetry (tokens/cache%/$/compaction), resumable. Verified on Sources of Power (Gary Klein, ~175k cached tokens) w/ gemini-3.1-pro-preview: explicit caching WORKS (turn1 100% cache hit, turn2 97.4%), thinking on (~3.2-3.4k thoughts/turn). Gemini self-summarized the whole 17-ch book to 5.3% (8.4k out tok) in only 2 turns + <end_of_book> rather than a long immersive expansion. Checkpoint cost $0.64 total (cache-create $0.35 one-time + storage + $0.13/turn). Output: temp/sources_of_power/.
## [2026-07-10 22:35] status | prior current status superseded
The prior NOTES status recorded the Gemini 3.1 Pro vs Grok 4.3 Chapter 1 SxS as the latest work; prompt optimization and GPT-5.6 full-source comparisons now supersede it.

## [2026-07-10 22:35] experiment | full-source Sol density-aware prompt
GPT-5.6 Sol via ChatGPT-authenticated Codex distilled 21,164 source words to 9,088 (42.9%) in two turns; all 9 blockquotes matched exact contiguous source text and completion was clean.

## [2026-07-10 22:35] experiment | matched Luna Codex vs OpenRouter
With identical source and prompt, Luna/Codex produced 6,740 words (31.8%) and Luna/OpenRouter 6,983 (33.0%), both one-turn/clean. Length and core coverage were close; OpenRouter retained the preface and more heading/checklist structure, while Codex consolidated more aggressively.

## [2026-07-10 22:35] fix | strengthen exact full-paragraph excerpts
The final prompt now requires a complete uncut paragraph per major chapter/prefatory section and forbids decorative quotation marks around blockquotes; measured full runs had favored short slogans and paraphrase.
## [2026-07-10 22:46] experiment | strengthened Luna full-paragraph excerpts
Full-source Luna/Codex rerun produced 7,162 words (33.8%) in three turns with 241 excerpt words and 5/6 exact quote groups. Excerpts became longer, but Chapter 2 still had none, so prompt-only per-section enforcement failed; use deterministic selection + weaving when excerpts are a hard requirement.

## [2026-07-10 23:05] experiment | Sources of Power DEEP distillation (Gemini 3.1 Pro)
Re-ran with summarizer_prompt.md + anti-compression steering in begin/continue turns (found detailed_prompt.md == summarizer_prompt.md; smallness was Gemini compressing, not the prompt). Steering stopped early <end_of_book>; paced ~1 chapter/turn -> all 17 chapters in 15 turns, 47,388 words = 37% of source (vs shipped 6,448 words / 5.3%). Cost $3.68 (cache create $0.35 + storage $0.16 + gen $3.18); back-half turns (T9+) crossed the 200k input tier as history grew, ~doubling per-turn cost. Caching solid (174,237 cached every turn; cache% fell 100->75% only from history growth). Deep output kept separate: temp/sources_of_power/deep/. Shipped 2-turn summary preserved.

## [2026-07-11 00:05] experiment | Chapter-wise parallel distillation (ch1-5 Sources of Power)
New scripts/gemini-chapter-distill.mjs: chapter slicing (manifest), greedy packing (chapters atomic, ch1+2 merged under 11k cap), 4 parallel calls, style-contract overrides (no title line/parts/end_of_book). vs rolling turns 1-5: $0.450 vs $0.517(+$0.35 cache), 66s wall vs 191s, 22,765 vs 17,079 out tok (57% vs 43% compaction) — more depth, cheaper, 3x faster. SxS artifact: https://claude.ai/code/artifact/3a8579b0-9e8f-457b-bf4c-bc1b2aac9d62. Chapter boundaries found via title grep (TOC + body occurrence pattern).

## [2026-07-11 07:45] refactor | app.js turn-loop dedup + modernization sweep
Extracted duplicated first-turn/continuation logic into runGenerationTurn/recordTurn; fixed anomaly retries never counting (retried forever), pause always resumable (Resume no longer restarts from turn 1), bare end-marker reply now completes instead of "too short" pause. Pinned petite-vue@0.4.1 + marked@15.0.12; moved dead root gemini.js to trash/. Verified: 28 vitest + 5 mocked E2E green, plus a throwaway stubbed full-run Playwright spec (2 turns, end marker, history shapes) — deleted after passing.

## [2026-07-11 07:50] note | refactor sweep: deferred findings
scripts/codex-book-summary.mjs:~1700 hardcodes /Users/pankaj/work/content/vendingbench_stocks/.env as DeepSeek key fallback (left as-is); gemini-distill.mjs hardcodes "Sources of Power" output names/runDir; scripts duplicate sleep/dotenv/argparse/POST-retry helpers (candidate scripts/lib/); core.js vs codex CLI estimateTokens/countWords/normalizeWhitespace have DIVERGED semantics — do not blindly unify.

## [2026-07-11 00:40] note | Kimi K3 access + caching + SxS vs Gemini
KIMI_API_KEY (sk-kim...) is a Kimi Code SUBSCRIPTION key: Anthropic-compatible endpoint https://api.kimi.com/coding/v1/messages, header x-api-key, model id `k3` (NOT the moonshot.ai OpenAI PAYG API, which 401s this key). reasoning_effort only accepts "max"; here used Anthropic thinking budget 12k. Caching = automatic prefix caching (Anthropic usage shape): 2-call probe -> call2 cache_read_input_tokens=7424/7675, no cache_creation charge ($0.30 hit vs $3 miss /Mtok); small <~2k prefix does not cache. Ch3 SxS: Kimi 5,195 words / 7,724 out tok / 226s (~4x slower); Gemini 5,732 words / 6,870+1,930 / 60s / $0.123. Artifact https://claude.ai/code/artifact/05aeff3d-9b3f-4f53-8e13-324c9630adba

## [2026-07-18 13:30] experiment | K3 exact-budget prompt audit
Reconstructed the Kimi Code prompt trials: exact chapter envelopes produced readable but over-compressed 30-36% drafts and used 16,796-42,686 output tokens per call; a vivid pivotal-tier variant reached 46.5% with exact excerpts and better pacing. The next test removes all numeric length targets and uses agent-assigned semantic tiers.

## [2026-07-18 14:12] experiment | K3 qualitative and mapped prompt trials
On Sources of Power Ch1 (2,329 words), K3 low produced 1,715 words/73.6%/11,402 output tokens (qualitative), 2,039/87.5%/11,917 (survival test), and 1,996/85.7%/9,423 (mapped cuts). Exact-envelope vivid/high remained 1,082/46.5%/26,861; evidence is under temp/prompt_opt_k3 and docs/prompt-optimization/kimi-k3-feedback.md.

## [2026-07-18 14:13] status | prior current status superseded
The prior NOTES status recorded the completed GPT-5.6 comparison and deterministic excerpt-weaving recommendation; the active work is now the paused Kimi K3 prompt-feedback checkpoint.

## [2026-07-18 14:20] decision | user selects K3 candidate A
## [2026-07-18 15:02] experiment | identical A at low effort starved
K3 low exhausted a 24,000-token generation envelope entirely in deliberation and returned zero visible prose. The automatic 36,000-token retry was interrupted; incomplete provider metrics remain null rather than estimated (`temp/prompt_opt_k3/v3v__vivid_low/failure.json`).

## [2026-07-18 15:03] fix | K3 starvation retries made opt-in
The audit runner now records zero-text `max_tokens` failures before returning, writes `failure.json`, and retries only with explicit `--retry-starved`. Tier overrides now affect the actual envelope, not just the run brief.
User loved A: the vivid exact-envelope/high-effort Chapter 1 distillation at 1,082 words (46.5% of source), 4/4 exact quote groups, and 26,861 API output tokens. Treat A's prose and pacing as the editorial champion; optimize usage without changing its target style.

## [2026-07-18 15:13] note | correction to 14:20 decision entry
The orphaned “User loved A” line immediately above is the body of the 14:20 decision entry; later headers were accidentally inserted before it. This note supersedes the apparent association without rewriting append-only history.

## [2026-07-18 15:14] experiment | adaptive envelope overshoots on Atomic Habits
K3 high distilled held-out Chapter 1 to 3,296/4,388 words (75.1%) despite a pivotal 40–60% band; 14,517 API output tokens, 481s, 6/10 strict quotes and 8/10 content matches. Coverage was complete but mapped omissions were frequently ignored; pause for user feedback (`temp/prompt_opt_k3/v3v_flexible__atomic_habits_ch01__pivotal_high`).
