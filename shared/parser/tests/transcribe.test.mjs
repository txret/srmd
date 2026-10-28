// transcribe(): a note as Markdown without srmd syntax, for other renderers, with its clozes marked.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parse, transcribe } from '../src/index.ts'
import * as tests from './transcribe.test.mjs'

// Readable marks; a host chooses punctuation its notes do not contain.
const marks = { open: '⟨', close: '⟩', filler: '·' }
/** The scheduling of a card without a definition, which keeps the negated ordinal as its reference. */
const blank = ordinal => ({
  ref: -ordinal, state: 'n', due: '0', scheduled_days: 0, last_review: '0', stability: 0, difficulty: 0,
  learning_steps: 0, reps: 0, lapses: 0
})

/** Clozes are marked and srmd syntax replaced, line for line; the inline cloze keeps its definition's scheduling. */
export function test_clozes_are_marked_and_srmd_syntax_replaced_line_for_line() {
  const source = `
Question:: answer[:1]

A list::

- one
- two

[:1]: k 20261016040000 1 20261015120000 2.3065 2.11810397 0 1 0
`.slice(1)
  assert.deepEqual(transcribe(parse(source), marks), {
    markdown: `
Question: ⟨answer⟩·

A list:

- one
- two

___
`.slice(1),
    inline: [{
      ordinal: 1, scheduling: {
        ref: 1, state: 'k', due: '20261016040000', scheduled_days: 1, last_review: '20261015120000', stability: 2.3065,
        difficulty: 2.11810397, learning_steps: 0, reps: 1, lapses: 0
      }
    }],
    block: [{ ordinal: 2, scheduling: blank(2), start_line: 4, end_line: 5, containers: [] }],
    metadata_lines: [7]
  })
}

/**
 * Marks stay off the whitespace, line endings and quote prefixes at a cloze's edges: the first cloze starts after
 * the line ending following its opener, the second ends before the hard break's spaces. CRLF stays.
 */
export function test_marks_stay_off_whitespace_line_endings_and_quote_prefixes() {
  const source = `
Question::\r
The answer.

> Q:: a\r
> b\x20\x20\r
> c`.slice(1)
  assert.deepEqual(transcribe(parse(source), marks), {
    markdown: `
Question:\r
⟨The answer.⟩

> Q: ⟨a\r
> b⟩\x20\x20\r
> c`.slice(1),
    inline: [{ ordinal: 1, scheduling: blank(1) }, { ordinal: 2, scheduling: blank(2) }],
    block: [],
    metadata_lines: []
  })
}

/**
 * Explicit markers and references become filler: a marker alone on its line leaves the filler rather than a blank
 * line, the filler delimits emphasis as the reference did, and the block cloze ends on its closer's line.
 */
export function test_explicit_markers_and_references_become_filler() {
  const source = `
x ::>**a**<::[:1] y

**b**[:2]**c**

Several blocks ::>

First.

<::`.slice(1)
  assert.deepEqual(transcribe(parse(source), marks), {
    markdown: `
x ·⟨**a**⟩·· y

**b**·**c**

Several blocks ·

First.

·`.slice(1),
    inline: [{ ordinal: 1, scheduling: blank(1) }],
    block: [{ ordinal: 2, scheduling: blank(2), start_line: 6, end_line: 8, containers: [] }],
    metadata_lines: []
  })
}

/**
 * A block cloze records the lists and quotes containing it. The inner group's answer is the nested list in the first
 * item, whose reference line keeps the item's indentation.
 */
export function test_a_block_cloze_records_its_containers() {
  const source = `
> OuterA::
>
> - InnerA:::
>   - one
>   - two
>
>   [:2]
> - B`.slice(1)
  assert.deepEqual(transcribe(parse(source), marks), {
    markdown: `
> OuterA:
>
> - InnerA:
>   - one
>   - two
>
>   ___
> - B`.slice(1),
    inline: [],
    block: [
      { ordinal: 1, scheduling: blank(1), start_line: 2, end_line: 7, containers: ['quote'] },
      { ordinal: 2, scheduling: blank(2), start_line: 3, end_line: 4, containers: ['quote', 'list'] }
    ],
    metadata_lines: [6]
  })
}

/** Headings and code keep srmd syntax as text; table cells hold inline clozes, here a group and its continuation. */
export function test_srmd_syntax_in_headings_code_and_table_cells() {
  const source = `
# Heading:: text[:1]

\`code:: text\`

| A        | B        |
|----------|----------|
| ::: one  | ::; two  |`.slice(1)
  assert.deepEqual(transcribe(parse(source), marks), {
    markdown: `
# Heading:: text[:1]

\`code:: text\`

| A        | B        |
|----------|----------|
| : ⟨one⟩  | : ⟨two⟩  |`.slice(1),
    inline: [{ ordinal: 1, scheduling: blank(1) }, { ordinal: 1, scheduling: blank(1) }],
    block: [],
    metadata_lines: []
  })
}

// Run every test_ function above as a test named after it.
for (const [name, fn] of Object.entries(tests)) if (name.startsWith('test_')) test(name, fn)
