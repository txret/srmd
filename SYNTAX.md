# srmd syntax

Flashcards typically isolate facts, while knowledge-base notes organize related information and evolve over time. Keeping both synchronized duplicates work. Using unobtrusive cloze and scheduling Markdown syntax srmd generates flashcards from knowledge-base notes: note-taking first, spaced repetition second. CommonMark and GFM terminology applies.

## Terminology

| Term            | Definition                                                                                                              |
|-----------------|-------------------------------------------------------------------------------------------------------------------------|
| Note            | Markdown file included in spaced repetition; suffix `.sr.md` (configurable).                                            |
| Cloze           | Content hidden during review.                                                                                           |
| Group           | Parse-time set of related clozes generating one card.                                                                   |
| Card            | Clozes reviewed together and their scheduling data.                                                                     |
| Card ordinal    | Sequential position determined by the group's first cloze; determines review order.                                     |
| Card definition | Link reference definition-like construct containing a card scheduling data                                              |
| Card reference  | Reference link-like construct linking a cloze group to its definition, positioned at the end of the groups first cloze. |

## Markdown structure

Markdown determines block and inline structure; escaping applies. Like other Markdown constructs srmd syntax is not recognized in code spans, code blocks, or HTML blocks; additionally srmd syntax is not recognized in headings (for Foam/Obsidian block anchor compatibility). Cloze markers are inline constructs. Clozes follow Markdown nesting and close in reverse opening order. Nesting a group inside itself is invalid, as is straddling an element boundary: `::>straddling **emphasis<:: boundaries**`. Malformed or improperly nested syntax has undefined behavior; no automatic repair is defined.

## Clozes

### Markers and groups

Two or more colons open a new group. Replacing the final colon with a semicolon creates a **continuation** cloze which is added to the latest group of that symbol count. Therefore, opening a new group of the same symbol count will make further continuations target the new group.

| Action                  | Implicit opener | Explicit opener |
|-------------------------|-----------------|-----------------|
| Start 2-symbol group    | `::`            | `::>`           |
| Continue 2-symbol group | `:;`            | `:;>`           |
| Start 3-symbol group    | `:::`           | `:::>`          |
| Continue 3-symbol group | `::;`           | `::;>`          |

Symbol counts need not be consecutive or ordered; `::::::::::>` may open a note's first group.

Implicit openers require a following space, tab, or line ending: `::: answer`, not `:::answer`. Explicit openers have no whitespace requirement.

An explicit closer is `<` followed by at least two marker symbols, with any semicolon last: `<::`, `<:::`, `<:;`, `<::;`, etc. It closes the most recently opened explicit cloze, regardless of group or opening vs continuation cloze. Matching the opener's symbol count and/or final symbol is optional, `<::` suffices.

### Scope and endings

An opener at a block's end (implicitly including paragraphs consisting only of the opener), excluding whitespace, opens a **block cloze**. Otherwise, it opens an **inline cloze**.

| Cloze                    | End                                                                             |
|--------------------------|---------------------------------------------------------------------------------|
| Implicit inline          | Before the next hard line break or parent element's end, whichever comes first. |
| Implicit block           | After the next Markdown block.                                                  |
| Explicit inline or block | At its closing marker.                                                          |

Inline clozes contain no blocks; block clozes contain one or more. Soft line breaks do not end inline clozes.

```markdown
:: Inline, even at a paragraph's start.

An explicit ::>inline answer<:: within a paragraph.

Question::
The soft line break keeps this answer inline.

A list::

- First answer item
- Second answer item

Outside the implicit block cloze.

Several blocks ::>

First answer paragraph.

Second answer paragraph.

<::

::

Only this next paragraph is included.

This paragraph is outside the cloze.
```

### Nesting and continuation

Groups can be nested and continued independently:

```markdown
OuterA::

- InnerA - first part:::
  - one
  - two
- InnerA - second part::;
  - three
  - four

OuterB - table::

| Item | First        | Second       |
|------|--------------|--------------|
| R1   | ::: InnerB 1 | ::; InnerB 2 |
| R2   | ::; InnerB 3 | ::; InnerB 4 |

OuterB:; again.
```

The list and table start separate groups, each with a nested group. The final `:;` continues the table's group.

## Card definitions

Block construct storing one card's scheduling data on one line, with fields separated by spaces or tabs:

```text
[:ref]: state due scheduled_days last_review stability difficulty learning_steps reps lapses
```

```markdown
A question:: an answer[:1]

[:1]: k 20261012040000 7 20261005120000 8.5 4.2 0 10 1
```

| Field            | Format and meaning                                                               |
|------------------|----------------------------------------------------------------------------------|
| `ref`            | Note-wide card-reference identifier.                                             |
| `state`          | `n` New, `l` Learning, `k` Known/Review, `r` Relearning, or a manual hint below. |
| `due`            | Next due local time: fourteen digits, `yyyymmddhhmmss`; `0` if unset.            |
| `scheduled_days` | Scheduled interval in days; nonnegative fixed-point decimal.                     |
| `last_review`    | Most recent local review time, formatted as `due`; `0` if absent.                |
| `stability`      | FSRS stability; nonnegative fixed-point decimal.                                 |
| `difficulty`     | FSRS difficulty; nonnegative fixed-point decimal.                                |
| `learning_steps` | Position in learning/relearning steps; nonnegative integer.                      |
| `reps`           | Total reviews; nonnegative integer.                                              |
| `lapses`         | Lapses; nonnegative integer.                                                     |

**NB** The FSRS data structure has 'elapsed days' but this is calculated from the other fields and not persisted separately.

A full definition has ten fields, including `ref`. The state is required; subsequent fields are positional, must match their formats, and default to zero when omitted. Decimal fields accept integers. Invalid definitions are rejected and processed as standard Markdown. FSRS elapsed days are calculated, not persisted. Cards with **blank scheduling** (`state` new and all fields 0) do not canoncially receive a definition (so missing definitions are treated as blank scheduling) although they are recognized.

Definitions are placed like link reference definitions: each on its own line, indented at most three spaces, wherever a paragraph could start, including inside list items and block quotes. Consecutive definitions need no blank lines between them. A definition cannot interrupt a paragraph: directly after a line of paragraph text it is part of that text. **Root-level** definitions are those outside list items and block quotes.

The scheduler checks nonzero timestamps for calendar validity: year ≥ 1, month 1–12, valid day for the month, hour 0–23, minute/second 0–59. Invalid dates are preserved exactly; affected cards are excluded from review queues and counted as *later* until corrected. The host may notify the user; other cards remain usable.

### Manual scheduling

Manual scheduling is editing a definition by hand to schedule its card: its state is temporarily replaced by a **hint**, a positive integer followed by `d`, `w`, or `m`, or the single character `!`. Parsing preserves hints and other fields. After reference matching, the scheduler applies hints in memory and reports a scheduling change.

| Hint | Due day                                                           |
|------|-------------------------------------------------------------------|
| `Nd` | N days ahead.                                                     |
| `Nw` | N × 7 days ahead.                                                 |
| `Nm` | N × 30 days ahead; fixed 30-day months.                           |
| `!`  | 7–21 days ahead, on the least-loaded day, breaking ties randomly. |

Intervals are capped at 36,500 days.

A hint sets state `k` and the due time at the configured local rollover on the selected day. These two fields are written back to the definition when the note is loaded, without other normalization.

The reviewer's fixed-interval choices, `tomorrow`, `soon` and `later`, are not manual scheduling: like the FSRS ratings they are reviews, saved through serialization.

## Card references

Associates a cloze group with its card and scheduling data: a colon and positive integer in brackets (`[:1]`, `[:2]`, etc.). References are recognized without definitions but cannot create cards. Escape the opening bracket (`\[:1]`) to preserve a literal occurrence through serialization. References are inline constructs in text. A line with only references, separated by optional spaces or tabs, is a block construct, a **reference line**, which follows Markdown block precedence, interruption, and container rules.

Only a card's first cloze receives a reference; continuations never claim references. References are canonically omitted from cards with blank scheduling but are allowed.

| First cloze                              | Reference position                                                   |
|------------------------------------------|----------------------------------------------------------------------|
| Explicit, inline or block                | Immediately after its closing marker.                                |
| Implicit inline                          | At the end of its content.                                           |
| Implicit block consisting of a paragraph | At the end of the paragraph's text.                                  |
| Other implicit block                     | On a separate line after its last block, inside that block's parent. |

For block references, canonically omit intervening blank lines unless Markdown requires separation to terminate the preceding block; optionally one blank line is permitted.

When first clozes share an ending, assign references innermost-to-outermost for all concerned clozes. Resolve ownership before definition lookup; a missing or unusable definition does not change assignment. In these circumstances also blank scheduling groups are assigned a reference (but no card definition) for disambiguation.

## HTML

| Construct                 | Output                               |
|---------------------------|--------------------------------------|
| Implicit opener           | One colon; starts the cloze wrapper. |
| Explicit opener/closer    | No output; marks wrapper boundaries. |
| Inline cloze              | `<span>` enclosing its content.      |
| Block cloze               | `<div>` enclosing its content.       |
| Card reference/definition | No output; supplies cloze metadata.  |

Cloze wrappers carry class `cloze`, `data-ordinal` (card ordinal) and `data-card` (current scheduling as a single-line card definition). In `data-card`, a card with a matched definition keeps that definition's identifier; any other card has the negated card ordinal, e.g. `[:-2]: n 0 0 0 0 0 0 0 0`. The note HTML is the same whichever card is reviewed.

The reviewer marks the reviewed card's clozes, the **active** clozes, with class `active`: hidden on the front, shown on the back. All other clozes are **inactive**: hidden on both sides by default, configurable. Inactive ancestors of active clozes remain visible on both sides. The reviewer hides a cloze by adding class `hide` and reveals it by removing that class.

## Loading and saving

Loading changes no Markdown on disk except for writing resolved hints (see manual scheduling above); any other restructuring/sorting occuring during parsing are memory only. Serialization runs when a review changes scheduling:

1. **Select and number references.** Select cards with scheduling data, all cards whose first clozes share those endings, and cards that own a reference. State `n` with all other fields zero has no scheduling data. Number selected cards consecutively from 1 in card order, with no placeholders for omitted groups.
2. **Place references.** Update existing references in place; write one for each selected group without one. Remove surplus and misplaced references in eligible Markdown. A new inline reference is written after a space where the text before it would otherwise absorb it: an implicit opener, `!` (an image), an escaping backslash, or a literal URL (`https://…`, `www.…`), which runs to the next whitespace.
3. **Update definitions.** Update matched definitions in place, written with all ten fields, including those of cards with blank scheduling. Insert new definitions for cards with scheduling data after the last root-level definition, or at EOF after a blank line if none exists. Remove orphaned and duplicate definitions. Sort the last run of root-level definitions (with nothing but blank lines between them), including the inserted ones, by ascending reference.

Preserve unrelated source and surrounding whitespace, including escaped references, syntax in excluded contexts, and malformed definitions.