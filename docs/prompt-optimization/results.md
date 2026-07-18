# Prompt optimization results

Date: 2026-07-10

## What was tested

The experiment used `The_First_90_Days_First_3_Sections.txt` and a representative first-half Chapter 1 slice. Mechanical checks report compression, excerpt share, contiguous source matching, and completion-marker behavior. Generated artifacts and usage metadata are under `temp/prompt_optimization/`.

Earlier slice runs changed both prompt and model/transport, so they show prompt iteration but do not isolate provider effects. The final Luna comparison holds the model slug, complete source, and prompt constant and changes only the route:

- Codex CLI with ChatGPT authentication: `gpt-5.6-luna`
- OpenRouter: `openai/gpt-5.6-luna`, medium reasoning

## Iteration results

| Run | Source words | Output words | Output/source | Exact quote groups | End behavior |
|---|---:|---:|---:|---:|---|
| Original prompt, Luna/OpenRouter, half chapter | 3,587 | 3,562 | 99.3% | 13/23 | Failed to mark supplied-source end |
| Ratio-first v1, Sol/Codex, half chapter | 3,587 | 1,549 | 43.2% | 4/4 | Clean |
| Coverage-ledger v2, Sol/Codex, half chapter | 3,587 | 1,378 | 38.4% | 6/6 | Clean |
| Density-aware final, Sol/Codex, full sample | 21,164 | 9,088 | 42.9% | 9/9 | Clean, two turns |
| Density-aware final, Luna/Codex, full sample | 21,164 | 6,740 | 31.8% | 8/10 | Clean, one turn |
| Density-aware final, Luna/OpenRouter, full sample | 21,164 | 6,983 | 33.0% | 2/7 strict; 6/7 content after removing added outer quote marks | Clean, one turn |
| Strengthened full-paragraph excerpts, Luna/Codex | 21,164 | 7,162 | 33.8% | 5/6 | Clean, three turns |

Word counts use the dependency-free evaluator in this folder and exclude the `<end_of_book>` marker.

## Findings

### Prompt changes mattered most

The original prompt's “maximize depth,” “fill the buffer,” and “do not skip details” instructions encouraged near-reproduction. It also treated the supplied excerpt as if the rest of the published book were still required, causing redundant continuation responses. Explicit source boundaries, a coverage ledger, compression priorities, and exact quotation rules fixed completion and substantially reduced length.

Testing the full three-section source showed that a hard percentage need not be placed in the generation prompt. Sol naturally produced a stable long-form result around 43%, while Luna landed close to one third. Compression ratio is therefore more useful as an observed evaluation metric than as a rigid instruction when preservation is the priority.

### Sol versus Luna differed materially

With the same final prompt and complete source, Sol/Codex produced 9,088 words (42.9%) while Luna/Codex produced 6,740 (31.8%). Sol was more expansive and retained more supporting explanation. Luna was more selective and happened to land in the originally imagined one-quarter-to-one-third range without being told to target it.

### Codex versus OpenRouter differed editorially, not fundamentally

The matched Luna outputs were close in size: 6,740 versus 6,983 words, a 3.6% difference. Both covered the introduction and Chapters 1–3, preserved the major stories and frameworks, completed in one response, and emitted exactly one end marker.

The editorial organization differed noticeably. OpenRouter retained the anniversary preface and more of the source's subsection/checklist hierarchy. Codex omitted the preface and consolidated more material under broader headings. The prose is independently generated rather than textually similar, which is expected from stochastic generation and different surrounding system/runtime instructions.

One run per route is enough to show that responses can differ, but not enough to estimate a stable “provider effect.” A stronger claim would require several repeated runs with the same settings and a blinded coverage rubric.

### Excerpts remain the main weakness

All final full-source runs paraphrased much more than desired. Luna/Codex used ten blockquote groups and Luna/OpenRouter seven, mostly short memorable lines rather than full paragraphs. The final prompt was therefore tightened after the measured runs to require at least one complete, uncut paragraph from every major chapter/prefatory section and to forbid decorative quotation marks around blockquotes.

The strengthened-prompt rerun increased quoted words only slightly, from 219 to 241, and reduced the number of quote groups from ten to six. Five groups were exact full-source matches. The excerpts became more substantial—up to 74 words—but the model still supplied no excerpt in Chapter 2, violating the explicit per-chapter rule. It also expanded from one response to three continuation turns. Stronger prompt wording therefore changed excerpt shape but did not reliably enforce excerpt coverage.

## Recommendation

Use Luna through Codex CLI for long-form scale and to avoid OpenRouter API charges. Keep Sol as the “more expansive” option when preserving secondary reasoning matters more than length.

Do not rely on prompt wording alone when verbatim excerpt coverage is non-negotiable. Use a two-stage workflow instead: first select and verify exact contiguous paragraphs from every major section, then supply those locked passages to Luna with instructions to weave them into the distillation unchanged. The post-run evaluator should remain the final gate.
