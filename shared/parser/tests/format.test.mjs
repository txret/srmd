// format(): Markdown with its blocks laid out anew and its inline content as written, unless that renders differently.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { foam_placeholders, foam_placeholders_html } from 'micromark-foam-placeholders'
import { default_format_options, format } from '../src/index.ts'
import { format_markdown } from '../src/format.ts'
import * as tests from './format.test.mjs'

/**
 * Blocks are one blank line apart and end with a line ending; headings are ATX, bullets `-`, ordered items numbered
 * up with `.`, list content indented one space after a bullet and to the next tab stop after a number, code fenced
 * and breaks `---`. Text keeps its escapes, brackets, underscores and asterisks. Formatted Markdown is returned as it is.
 */
export function test_blocks_are_laid_out_and_inline_content_kept_as_written() {
  const source = `
Title
=====
A snake_case word, [brackets], 2*3*4 and \\*escapes\\*.
* one
* two
    * nested


1) first
1) second
   - under

Code:

    indented code
***`.slice(1)
  const formatted = `
# Title

A snake_case word, [brackets], 2*3*4 and \\*escapes\\*.

- one
- two
  - nested

1.  first
2.  second
    - under

Code:

\`\`\`
indented code
\`\`\`

---
`.slice(1)
  assert.equal(format(source), formatted)
  assert.equal(format(formatted), formatted)
  assert.equal(format(''), '')
  assert.equal(format('\n\n  \n'), '')
}

/**
 * srmd's inline syntax stays as written. A reference line stands directly below its block, its references without
 * spaces between them; definitions stand on consecutive lines, link definitions among them, with single spaces between
 * a card definition's fields, after a blank line, which a definition needs below a paragraph.
 */
export function test_srmd_syntax_is_kept_and_its_lines_placed() {
  const source = `
Question:: answer[:1]
Explicit ::>hidden<:: and a continuation :;  too.

A list::
- one
- two

[:2]  [:3]
[:1]:   k 20261012040000 7 20261005120000 8.5 4.2 0 10 1

[link]: https://example.com  "Title"
[:2]:\t3d
`.slice(1)
  assert.equal(format(source), `
Question:: answer[:1]
Explicit ::>hidden<:: and a continuation :;  too.

A list::

- one
- two
[:2][:3]

[:1]: k 20261012040000 7 20261005120000 8.5 4.2 0 10 1
[link]: https://example.com  "Title"
[:2]: 3d
`.slice(1))
}

/**
 * A reference line keeps a blank line above it in a loose list item, which would otherwise become tight, and below
 * HTML, which only a blank line ends. One farther than a blank line from the block above it belongs to no card, and
 * stays two blank lines away.
 */
export function test_reference_lines_keep_blank_lines_where_needed() {
  const source = `
- A list::
  - one

  [:1]
- two

Block::

<div>
HTML
</div>

[:2]

Far::

- one



[:3]
`.slice(1)
  assert.equal(format(source), `
- A list::

  - one

  [:1]
- two

Block::

<div>
HTML
</div>

[:2]

Far::

- one


[:3]
`.slice(1))
}

/**
 * Quotes and list items write their own prefixes, also on lazy lines. Indentation of fewer than four columns on a
 * continuation line goes; deeper indentation stays, so `#` starts no heading. Trailing spaces go, and a hard break of
 * spaces becomes a backslash, except after a backslash, which stays literal at the end of a paragraph.
 */
export function test_line_prefixes_and_ends_are_rewritten() {
  const source = `
> Quote line
lazy line\x20\x20
> literal backslash\\\x20\x20
- item\x20
   continued
      # not a heading
`.slice(1)
  assert.equal(format(source), `
> Quote line
> lazy line\\
> literal backslash\\

- item
  continued
      # not a heading
`.slice(1))
}

/**
 * Tables are aligned, their delimiter rows without spaces and as wide as the cells, and their cells as written, escaped
 * dividers and srmd syntax included.
 */
export function test_tables_are_aligned_with_cells_as_written() {
  const source = `
| Valve | Side | Note |
|:-|-:|:-:|
| Mitral | ::: left | a |
| Tricuspid \\| x | ::; right[:1] | |
`.slice(1)
  assert.equal(format(source), `
| Valve          |          Side | Note |
|:---------------|--------------:|:----:|
| Mitral         |      ::: left |   a  |
| Tricuspid \\| x | ::; right[:1] |      |
`.slice(1))
}

/** YAML front matter stays as written, as do Foam's wiki links, embeds and block anchors, with its extension or without. */
export function test_front_matter_and_foam_syntax_are_kept() {
  const source = `
---
title: Heart
tags: [cardio]
---
See [[Physiology#Heart|the heart]] and ![[ecg.png]]. ^anchor
`.slice(1)
  const formatted = `
---
title: Heart
tags: [cardio]
---

See [[Physiology#Heart|the heart]] and ![[ecg.png]]. ^anchor
`.slice(1)
  assert.equal(format(source, [{ syntax: foam_placeholders(), html: foam_placeholders_html() }]), formatted)
  assert.equal(format(source), formatted)
}

/**
 * A task list item's check is written `[ ]` or `[x]`, with one space before its text. A heading's text ending in `#`
 * after a space is escaped as an ATX heading, which would take it as its closing sequence; a heading spanning lines
 * stays a setext heading.
 */
export function test_checks_and_headings_keep_their_text() {
  const source = `
- [ ]  open
- [X] done

C #
===
# Closed ##
Two
lines
---
`.slice(1)
  assert.equal(format(source), `
- [ ] open
- [x] done

# C \\#

# Closed

Two
lines
-----
`.slice(1))
}

/** A thematic break below a paragraph in a tight list item is written with asterisks: dashes would underline it. */
export function test_a_thematic_break_keeps_a_list_tight() {
  assert.equal(format(`
* a
  - - -
* b
`.slice(1)), `
- a
  ***
- b
`.slice(1))
}

/** Line endings and a byte order mark stay. */
export function test_line_endings_and_byte_order_mark_are_kept() {
  assert.equal(format('\uFEFF* a\r\n* b\r\n\r\n\r\ntext'), '\uFEFF- a\r\n- b\r\n\r\ntext\r\n')
  assert.equal(format('a\r\rb'), 'a\r\rb\r')
}

/**
 * With wrap 'always', paragraphs wrap at the line width, which counts list markers and quote prefixes, and the further
 * lines of a container are indented to its content. Code spans and links' destinations do not break; a word longer
 * than the space left stands on a line of its own. The line break after an implicit opener stays, as a space would
 * render differently. Wrapped Markdown is returned as it is.
 */
export function test_paragraphs_wrap_at_the_line_width() {
  const source = `
The heart has four chambers, two atria and two ventricles. See \`two words\` and [link text](https://example.com "a title").

- A list item that wraps, its further lines indented to its content.
  > And a quote inside the item.

Question::
The line break after the opener stays, as a space renders differently.
`.slice(1)
  const wrapped = `
The heart has four chambers,
two atria and two ventricles.
See \`two words\` and [link
text](https://example.com "a title").

- A list item that wraps, its
  further lines indented to
  its content.
  > And a quote inside the
  > item.

Question::
The line break after the
opener stays, as a space
renders differently.
`.slice(1)
  assert.equal(format(source, [], { wrap: 'always', line_width: 30 }), wrapped)
  assert.equal(format(wrapped, [], { wrap: 'always', line_width: 30 }), wrapped)
}

/**
 * Wrapping breaks no line before a word that would start a block there, such as a bullet, an ordered item's number or
 * a heading's `#`, nor after a backslash that would escape the line break: such a line runs past the width.
 */
export function test_wrapping_starts_no_block() {
  assert.equal(format('aaaa bbbb - cccc dddd 1. eeee ffff # gggg', [], { wrap: 'always', line_width: 9 }), `
aaaa bbbb -
cccc dddd 1.
eeee ffff #
gggg
`.slice(1))
  assert.equal(format('aaaa\\ bbbb', [], { wrap: 'always', line_width: 5 }), 'aaaa\\ bbbb\n')
}

/**
 * With wrap 'never', each paragraph is one line, the line breaks of code spans included; hard breaks and the line
 * break after an implicit opener stay.
 */
export function test_paragraphs_join_onto_one_line() {
  const source = `
One line
and another\\
after a hard break, \`code
span\` joined.

Question::
answer stays below
the opener.
`.slice(1)
  assert.equal(format(source, [], { wrap: 'never' }), `
One line and another\\
after a hard break, \`code span\` joined.

Question::
answer stays below the opener.
`.slice(1))
}

/**
 * The bullet and numbering options apply to every list, a list right after another of the same kind taking the other
 * bullet, which keeps them apart; padded table delimiter rows have spaces.
 */
export function test_lists_and_tables_follow_the_options() {
  const source = `
- a
- b

* c

3) x
3) y

| a | b |
|:-|-:|
| c | d |
`.slice(1)
  assert.equal(format(source, [], { bullet: '*', numbering: 'repeat', table_delimiters: 'padded' }), `
* a
* b

- c

3.  x
3.  y

| a  |  b |
| :- | -: |
| c  |  d |
`.slice(1))
}

/**
 * Emphasis and strong emphasis take the delimiters the options name, in paragraphs, headings and table cells alike,
 * unless underscores would stand within a word, where they delimit nothing. Nested emphasis keeps its runs apart.
 */
export function test_emphasis_and_strong_take_the_chosen_delimiters() {
  const source = `
*em* and _em_, **st** and __st__, snake*case*word, ***both*** and *__mixed__*.
`.slice(1)
  assert.equal(format(source, [], { emphasis: 'underscore', strong: 'asterisk' }), `
_em_ and _em_, **st** and **st**, snake*case*word, _**both**_ and _**mixed**_.
`.slice(1))
  assert.equal(format(source, [], { emphasis: 'asterisk', strong: 'underscore' }), `
*em* and *em*, __st__ and __st__, snake*case*word, *__both__* and *__mixed__*.
`.slice(1))
  assert.equal(format(`
# A _b_ c

| _x_ |
|---|
| __y__ |
`.slice(1), [], { emphasis: 'asterisk', strong: 'asterisk' }), `
# A *b* c

| *x*   |
|-------|
| **y** |
`.slice(1))
}

/**
 * A text whose rewrite renders differently from the text as written is written as it is: here a rendering that tells
 * every rewrite apart keeps the paragraph from wrapping and its emphasis from changing.
 */
export function test_rewrites_rendering_differently_are_dropped() {
  const options = { ...default_format_options, wrap: 'always', line_width: 10, emphasis: 'underscore' }
  assert.equal(format_markdown('A *long* paragraph to wrap.\n', [], options, markdown => markdown), 'A *long* paragraph to wrap.\n')
  assert.equal(format_markdown('A *long* paragraph to wrap.\n', [], options, () => ''), 'A _long_\nparagraph\nto wrap.\n')
}

/**
 * A result rendering differently from the source is a defect, and none is returned: a table row with more cells than
 * its header, which GFM ignores, would widen the header.
 */
export function test_formatting_that_renders_differently_is_refused() {
  assert.equal(format(`
| a |
|---|
| b | extra |
`.slice(1)), null)
}

// Run every test_ function above as a test named after it.
for (const [name, fn] of Object.entries(tests)) if (name.startsWith('test_')) test(name, fn)
