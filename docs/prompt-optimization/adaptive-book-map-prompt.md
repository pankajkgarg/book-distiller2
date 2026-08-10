# Adaptive whole-book editorial map

Use this prompt with a strong reasoning model that can read the complete nonfiction
book before any reader-facing prose is generated. This stage makes editorial
selection decisions; it does not write the distillation.

## Editorial objective

Design the book as it would read after an excellent editor removed everything that
does not earn its space. The result is not a synopsis, study guide, or fixed-ratio
compression. It should retain the experience of reading the book: the examples that
make lessons understandable or memorable, the reasoning needed to believe them,
important caveats and applications, and selected passages whose original wording
has unusual explanatory, rhetorical, emotional, or mnemonic value.

Compression must be deliberately uneven. A dense section may survive at generous
depth; a long repetitive section may collapse to a sentence or disappear. Chapters
have no minimum allocation. Judge material relative to the complete book, not only
to its local chapter.

## Global comparison

Read the entire source before making chapter decisions. Build a ledger of the
book's distinct claims, mechanisms, distinctions, frameworks, caveats, practices,
and conclusions. Then cluster stories, studies, examples, and analogies by the
contribution they make to those ideas.

For every example considered for preservation, identify what work it performs:

- reveals or makes a mechanism understandable;
- supplies unusually convincing evidence;
- establishes a boundary, failure mode, or counterexample;
- shows transfer into a meaningfully different setting;
- provides a memorable emotional or visual anchor;
- demonstrates an application the reader could use; or
- merely repeats a point already established more effectively elsewhere.

Multiple examples may survive for the same idea when they perform different work.
Do not impose a numerical example quota. Conversely, vividness, celebrity, a large
cast, or the presence of quotable detail does not by itself make an example
essential. Names should remain natural inside selected stories, but names and
biographical facts are not independent payload.

## Selection labels

Make granular decisions at the level of arguments, subsections, stories, studies,
and repeated passages rather than assigning one depth to a whole chapter.

- `Scene`: preserve a selected example as a causal narrative with enough setup,
  consequential action, result, and concrete detail to make its lesson memorable.
  State the unique function that earns scene treatment. Conceptual importance alone
  does not qualify an item as a scene.
- `Explain`: fully explain an important claim, mechanism, framework, distinction, or
  caveat, but do not expand its supporting people or incidents into scenes. Specify
  the reasoning that must survive.
- `Evidence`: retain a study, statistic, example, or transfer case compactly as
  support for an already stated idea. Preserve the result and the interpretive
  reason it matters; omit research logistics, casts, and decorative detail.
- `Mention`: retain a small distinct qualification, bridge, or application in a
  sentence or clause. Do not introduce a miniature anecdote.
- `Omit`: remove safely because it is publishing furniture, setup without payoff,
  redundant proof, a weaker parallel illustration, repeated explanation, research
  logistics without interpretive value, or material superseded elsewhere. Name the
  concrete source element and where its useful contribution is already covered.
- `Excerpt`: identify exact start and end anchors for a source paragraph or compact
  passage whose original language is worth preserving, and state why paraphrase
  would lose value. Prefer complete paragraphs that carry the author's explanatory
  or rhetorical voice over isolated slogans. Excerpts are selected by value, not
  allocated per chapter; a chapter may have none or several. Do not copy long
  passages into the map.

Do not use `Evidence` or `Mention` as a parking lot for every borderline anecdote. A compressed
roll call of stories and names is still clutter. If an example adds no distinct
understanding after the chosen evidence, omit it completely.

The labels separate conceptual importance from narrative depth. A chapter may have
many important `Explain` items and several useful `Evidence` items without granting
all of them scene treatment. It may also have multiple `Scene` items when each earns
that treatment through a genuinely different function; there is no scene quota.

## Required outputs

Write all requested files supplied by the run instruction:

1. `global_map.md`, containing:
   - Identity and nonfiction subtype
   - Payload and bloat profile specific to this book
   - Argument arc
   - Distinct-contribution ledger
   - Cross-chapter evidence clusters, including the role of each retained example
     and concrete redundancies to cut
   - Voice/excerpt plan
   - Global continuity and anti-repetition notes
   - Validation of chapter boundaries and coverage

2. `titles.json`, mapping every logical chapter number to its canonical title.

3. One `chapter_briefs/chNN.md` file per logical chapter, containing:
   - Chapter role in the whole book
   - Unique contribution, if any
   - Already established material that must not be retaught
   - Ordered, source-anchored `Scene`, `Explain`, `Evidence`, `Mention`, `Omit`, and
     `Excerpt` decisions
   - Dependencies and handoff to adjacent chapters
   - A short editorial shape note explaining where the chapter should breathe and
     where it should move quickly, without specifying a word count or percentage

The briefs are binding selection plans for a separate prose model. Make the hard
choices here; do not tell the writer merely to "remove repetition" or decide later.
Use only the supplied source, preserve its order and degree of certainty, and do not
import outside knowledge.
