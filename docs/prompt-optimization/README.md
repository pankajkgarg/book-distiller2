# Long-form book-distillation prompt experiment

This folder records the prompt optimization requested on 2026-07-10.

## Iterations

1. `v0-original.md`: baseline prompt. It asks for maximum depth and full excerpts but has no measurable compression target. On a 3,683-word Chapter 1 slice, GPT-5.6 Luna produced 3,610 words (98.0%) and then several redundant continuation responses.
2. `v1-ratio-first.md`: introduces a hard 25–33% target, explicit content priorities, exact-quote rules, source boundaries, and a completion contract.
3. `v2-coverage-ledger.md`: adds silent section-level planning, a target center of 29%, a coverage ledger, a 20–35% excerpt budget, causal-story preservation, framework-detail rules, and a stricter continuation protocol.
4. A proposed hard-ceiling revision was discarded before testing after feedback that a short slice has disproportionate structural overhead and that fidelity should not be sacrificed to a percentage.
5. `../../detailed_prompt.md` (final): uses a density-aware “compression compass,” keeps the coverage ledger and exact-excerpt safeguards, and treats the observed compression ratio as an evaluation metric rather than a generation quota.

## Evaluation dimensions

- **Compression:** final words / source words, reported as an observation rather than a hard pass/fail gate.
- **Coverage:** every source chapter/major section is represented, with core claims, defining stories, frameworks, and caveats intact.
- **Excerpt fidelity:** every blockquote is contiguous verbatim source text; paraphrases are never blockquoted.
- **Narrative quality:** reads as a shortened edition rather than a review or checklist.
- **Boundary behavior:** no request for unavailable text; exactly one `<end_of_book>` after all supplied text is covered.

Run the mechanical checks with:

```bash
node docs/prompt-optimization/evaluate.mjs <source.txt> <summary.md>
```

The generated outputs and run metadata are kept under `temp/prompt_optimization/` because they are experiment artifacts, not product source.

See `results.md` for the measured Sol/Luna and Codex/OpenRouter comparison.
