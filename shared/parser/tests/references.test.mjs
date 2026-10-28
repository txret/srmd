// Card references (SYNTAX.md, "Card references"): where they are recognized, and which card owns each.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parse, render, serialize, serialize_card } from '../src/index.ts'
import * as tests from './references.test.mjs'

/** Each card of a parse as its definition line, in card order; `[:-n]` marks card n without a definition. */
function card_lines(parsed) {
  return parsed.scheduling.map(serialize_card).join('\n')
}

/**
 * The first card of a note made of body and a definition for reference 1: `owner` when [:1] in body belongs to that
 * card, `not_owner` when it belongs to no card.
 */
function first_card(body) {
  return serialize_card(parse(body + '\n\n[:1]: k 20261014040000 7 20261007120000 8.5 4.2 0 10 1\n').scheduling[0])
}
const owner = '[:1]: k 20261014040000 7 20261007120000 8.5 4.2 0 10 1'
const not_owner = '[:-1]: n 0 0 0 0 0 0 0 0'

/**
 * A reference renders nothing wherever srmd syntax is recognized, owned or not. In a heading, in code and after a
 * backslash it is literal text, which claims no definition and which saving keeps.
 */
export function test_references_are_hidden_in_text_and_literal_in_headings_code_and_escapes() {
  const mixed = parse(`
# Title [:1]

Text [:2] more, \\[:3] and \`[:4]\`.

    [:5]
`.slice(1))
  assert.equal(render(mixed.events), `
<h1>Title [:1]</h1>
<p>Text  more, [:3] and <code>[:4]</code>.</p>
<pre><code>[:5]
</code></pre>
`.slice(1))
  assert.deepEqual(mixed.references.map(reference => reference.ref), [2])

  // The backslash escapes the first bracket only.
  assert.equal(render(parse('Q:: answer \\[:1][:2]').events),
    '<p>Q: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">answer [:1]</span></p>')

  const code = `
Literal \`code[:1]\` and \\[:2]

\`\`\`md
[:3]: n 0 0 0 0 0 0 0 0
\`\`\``.slice(1)
  const in_code = parse(code)
  assert.equal(render(in_code.events), `
<p>Literal <code>code[:1]</code> and [:2]</p>
<pre><code class="language-md">[:3]: n 0 0 0 0 0 0 0 0
</code></pre>`.slice(1))
  assert.equal(serialize(in_code, in_code.scheduling), code)

  // An answer of indented code keeps its literal reference, which claims no card; the orphan definition goes.
  const code_answer = parse(`
Q::

    answer[:8]

[:8]: k 20261012040000 7 20261005120000 8.5 4.2 0 10 1
`.slice(1))
  assert.equal(card_lines(code_answer), '[:-1]: n 0 0 0 0 0 0 0 0')
  assert.equal(render(code_answer.events), `
<p>Q:</p>
<div class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">
<pre><code>answer[:8]
</code></pre></div>
`.slice(1))
  assert.equal(serialize(code_answer, code_answer.scheduling), `
Q::

    answer[:8]
`.slice(1))
}

/** `[:1]:` starting a line or block is a definition label, never a reference, so a malformed definition is text. */
export function test_a_definition_label_starting_a_line_is_never_a_reference() {
  const parsed = parse(`
[:1]: k nope

- [:2]: k nope

> [:3]: k nope

Q:: a[:4]: b
`.slice(1))
  assert.equal(render(parsed.events), `
<p>[:1]: k nope</p>
<ul>
<li>[:2]: k nope</li>
</ul>
<blockquote>
<p>[:3]: k nope</p>
</blockquote>
<p>Q: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">a: b</span></p>
`.slice(1))
  assert.deepEqual(parsed.references.map(reference => reference.ref), [4])
}

/** A reference line holds references and whitespace only, and renders nothing; with other text it is a paragraph. */
export function test_reference_lines_hold_only_references() {
  const parsed = parse(`
Q::

\`\`\`
x
\`\`\`
[:2] [:1]
[:3] text
`.slice(1))
  assert.equal(render(parsed.events), `
<p>Q:</p>
<div class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">
<pre><code>x
</code></pre></div>
<p> text</p>
`.slice(1))
  // Each reference as [identifier, whether it stands on a reference line].
  assert.deepEqual(parsed.references.map(reference => [reference.ref, !!reference.line]), [[2, true], [1, true], [3, false]])
}

/**
 * A hidden reference leaves the whitespace around it, which Markdown reads as without it: spaces before it are no
 * hard break, spaces after it are; trailing spaces end a paragraph; a backslash before its space is literal.
 */
export function test_hidden_references_leave_the_whitespace_around_them() {
  assert.equal(render(parse(`
Q:: answer  [:1]
next`.slice(1)).events), `
<p>Q: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">answer \x20
next</span></p>`.slice(1))

  assert.equal(render(parse(`
Q:: answer[:1]\x20\x20
next`.slice(1)).events), `
<p>Q: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">answer</span><br />
next</p>`.slice(1))

  assert.equal(render(parse(`
:: first
second[:1]\x20\x20

next`.slice(1)).events), `
<p>: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">first
second</span></p>
<p>next</p>`.slice(1))

  assert.equal(render(parse(`
\x20\x20
Q:: answer[:1]\t\x20
`.slice(1)).events), `
<p>Q: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">answer</span></p>
`.slice(1))

  assert.equal(render(parse('Q:: ends\\ [:1]').events),
    '<p>Q: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">ends\\ </span></p>')
  assert.equal(render(parse(`
Q:: ends\\ [:1]
next`.slice(1)).events), `
<p>Q: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">ends\\\x20
next</span></p>`.slice(1))
}

/**
 * A reference changes no Markdown structure around it: it is not the whitespace an implicit opener needs, a fence
 * line with it does not close the code, and a list or table it ends keeps its form.
 */
export function test_a_reference_changes_no_markdown_structure_around_it() {
  const opener = parse(`
Q::[:1]

answer`.slice(1))
  assert.equal(render(opener.events), `
<p>Q::</p>
<p>answer</p>`.slice(1))
  assert.deepEqual(opener.scheduling, [])

  // The code runs on to the end, so the hint definition in it is code too.
  const fence = parse(`
Q::

\`\`\`txt
answer
\`\`\`[:7]

[:7]: ! 0 0 0 0 0 0 0 0`.slice(1))
  assert.equal(card_lines(fence), '[:-1]: n 0 0 0 0 0 0 0 0')
  assert.equal(render(fence.events), `
<p>Q:</p>
<div class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">
<pre><code class="language-txt">answer
\`\`\`[:7]

[:7]: ! 0 0 0 0 0 0 0 0
</code></pre>
</div>`.slice(1))

  assert.equal(render(parse(`
Q::

- one
- two[:1]`.slice(1)).events), `
<p>Q:</p>
<div class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">
<ul>
<li>one</li>
<li>two</li>
</ul></div>`.slice(1))

  assert.equal(render(parse(`
Q::

| A | B |
| - | - |
| x | y |[:1]`.slice(1)).events), `
<p>Q:</p>
<div class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">
<table>
<thead>
<tr>
<th>A</th>
<th>B</th>
</tr>
</thead>
<tbody>
<tr>
<td>x</td>
<td>y</td>
</tr>
</tbody>
</table></div>`.slice(1))
}

/** A block cloze ending in code owns a reference line after the code, or after one blank line, not two. */
export function test_a_block_cloze_reference_after_code() {
  assert.equal(first_card('Q::\n\n```\nx\n```\n[:1]'), owner)
  assert.equal(first_card('Q::\n\n```\nx\n```\n\n[:1]'), owner)
  assert.equal(first_card('Q::\n\n```\nx\n```\n\n\n[:1]'), not_owner)
  // The reference line ends indented code.
  assert.equal(first_card('Q::\n\n    x\n[:1]'), owner)
}

/**
 * A block cloze ending in a paragraph owns a reference at the end of the paragraph's text, also after emphasis
 * delimiters ending it; not on a line after it.
 */
export function test_a_block_cloze_reference_after_a_paragraph() {
  assert.equal(first_card('Q::\n\nanswer[:1]'), owner)
  assert.equal(first_card('Q::\n\n**answer**[:1]'), owner)
  // A reference line interrupts the paragraph, and stands after its text rather than at its end.
  assert.equal(first_card('Q::\n\nanswer\n[:1]'), not_owner)
  assert.equal(first_card('Q::\n\nanswer\n\n[:1]'), not_owner)
}

/** A block cloze ending in a list owns a reference line after the list, which the line ends, not inside it. */
export function test_a_block_cloze_reference_after_a_list() {
  assert.equal(first_card('Q::\n\n- a\n- b\n[:1]'), owner)
  assert.equal(first_card('Q::\n\n- a\n- b\n\n[:1]'), owner)
  assert.equal(first_card('Q::\n\n- a\n- b[:1]'), not_owner)
  // When the last item ends in code: the line after the code ends the list, not one inside the item.
  assert.equal(first_card('Q::\n\n- a\n\n  ```\n  x\n  ```\n[:1]'), owner)
  assert.equal(first_card('Q::\n\n- a\n\n  ```\n  x\n  ```\n  [:1]'), not_owner)
}

/** A block cloze ending in a quote owns a reference line after it, in the quote's own container, not inside it. */
export function test_a_block_cloze_reference_after_a_quote() {
  assert.equal(first_card('Q::\n\n> q\n[:1]'), owner)
  assert.equal(first_card('Q::\n\n> q\n\n[:1]'), owner)
  assert.equal(first_card('Q::\n\n> q\n\n\n[:1]'), not_owner)
  assert.equal(first_card('Q::\n\n> q\n> [:1]'), not_owner)
  assert.equal(first_card('Q::\n\n> q [:1]'), not_owner)
  assert.equal(first_card('Q::\n\n> ```\n> x\n> ```\n[:1]'), owner)
  // A quote in a quote: the line after it is inside the outer quote.
  assert.equal(first_card('> Q::\n>\n> > q\n>\n> [:1]'), owner)
}

/** A block cloze ending in a table, HTML or a heading owns a reference line after it, or after the blank line ending it. */
export function test_a_block_cloze_reference_after_a_table_html_or_heading() {
  assert.equal(first_card('Q::\n\n| a |\n| - |\n| b |\n[:1]'), owner)
  assert.equal(first_card('Q::\n\n| a |\n| - |\n| b |\n\n[:1]'), owner)
  assert.equal(first_card('Q::\n\n<div>\nx\n</div>\n\n[:1]'), owner)
  assert.equal(first_card('Q::\n\n# H\n[:1]'), owner)
}

/** An explicit block cloze owns a reference right after its closer, not one before the closer. */
export function test_an_explicit_block_cloze_reference_follows_its_closer() {
  assert.equal(first_card('Q ::>\n\nanswer\n\n<::[:1]'), owner)
  assert.equal(first_card('Q ::>\n\nanswer[:1]\n\n<::'), not_owner)
}

/**
 * An implicit inline cloze owns a reference at the end of its content, after spaces too, and before the hard break
 * ending it; not after that break, on the next line, or before more of its text.
 */
export function test_an_implicit_inline_cloze_reference_ends_its_content() {
  assert.equal(first_card('Q:: answer[:1]'), owner)
  assert.equal(first_card('Q:: answer [:1]'), owner)
  assert.equal(first_card('Q:: answer[:1]\\\nmore'), owner)
  assert.equal(first_card('Q:: answer\\\n[:1]'), not_owner)
  assert.equal(first_card('Q:: answer\n[:1]'), not_owner)
  assert.equal(first_card('Q:: answer[:1] more'), not_owner)
}

/**
 * An explicit inline cloze owns a reference right after its closer, with text after it, also when the close waits
 * for emphasis; not one before its closer.
 */
export function test_an_explicit_inline_cloze_reference_follows_its_closer() {
  assert.equal(first_card('Q ::>answer<::[:1] more'), owner)
  assert.equal(first_card('Q::>a **b<::[:1] c** d'), owner)
  assert.equal(first_card('Q ::>answer[:1]<:: more'), not_owner)
}

/**
 * A reference after an explicit closer and spaces stays owned and in place, spaces included, and the spaces render
 * after the cloze.
 */
export function test_a_reference_after_an_explicit_closer_keeps_the_spaces_before_it() {
  const parsed = parse(`
some::> cloze <::  [:2]

[:2]: l 0 0 0 0 0 0 1 0
`.slice(1))
  assert.equal(card_lines(parsed), '[:2]: l 0 0 0 0 0 0 1 0')
  assert.equal(render(parsed.events), `
<p>some<span class="cloze" data-ordinal="1" data-card="[:2]: l 0 0 0 0 0 0 1 0"> cloze </span>  </p>
`.slice(1))
  assert.equal(serialize(parsed, parsed.scheduling), `
some::> cloze <::  [:1]

[:1]: l 0 0 0 0 0 0 1 0
`.slice(1))
}

/**
 * In a table cell and in emphasis, an inline cloze's reference goes inside the element ending the cloze: before the
 * delimiter closing emphasis that ends it, after delimiters closing emphasis within its answer.
 */
export function test_an_inline_cloze_reference_inside_cells_and_emphasis() {
  assert.equal(first_card('| Q:: answer[:1] |\n| - |'), owner)
  assert.equal(first_card('*Q:: answer[:1]*'), owner)
  assert.equal(first_card('*Q:: answer*[:1]'), not_owner)
  assert.equal(first_card('Q:: an ~~*answer*~~[:1]'), owner)
  assert.equal(first_card('*Q:: answer  \nmore*[:1]'), not_owner)
}

/**
 * Where first clozes share an ending, the references there go to their cards innermost first, in reading order
 * rather than by identifier; a block cloze and the inline cloze ending its last paragraph share an ending too. A
 * continuation ending there takes none. Saving numbers them in card order, written innermost first.
 */
export function test_references_at_a_shared_ending_go_to_its_cards_innermost_first() {
  const nested = parse(`
Q:: outer ::: inner[:9][:7]

[:7]: l 0 0 0 0 0 0 7 0
[:9]: l 0 0 0 0 0 0 9 0
`.slice(1))
  assert.equal(card_lines(nested), `
[:7]: l 0 0 0 0 0 0 7 0
[:9]: l 0 0 0 0 0 0 9 0`.slice(1))
  assert.equal(serialize(nested, nested.scheduling), `
Q:: outer ::: inner[:2][:1]

[:1]: l 0 0 0 0 0 0 7 0
[:2]: l 0 0 0 0 0 0 9 0
`.slice(1))

  assert.equal(card_lines(parse(`
Q::

A:: b[:3][:9]

[:3]: k 20261014040000 3 20261007120000 8.5 4.2 0 3 0
[:9]: k 20261014040000 9 20261007120000 8.5 4.2 0 9 0
`.slice(1))), `
[:9]: k 20261014040000 9 20261007120000 8.5 4.2 0 9 0
[:3]: k 20261014040000 3 20261007120000 8.5 4.2 0 3 0`.slice(1))

  // The innermost first cloze takes the one reference, though the continuation of card 1 ends there too; saving
  // also gives the middle card a reference, so that ownership stays unambiguous.
  const lone = parse(`
Q:: early

Q:; outer ::: middle :::: inner[:7]

[:7]: l 0 0 0 0 0 0 7 0
`.slice(1))
  assert.equal(card_lines(lone), `
[:-1]: n 0 0 0 0 0 0 0 0
[:-2]: n 0 0 0 0 0 0 0 0
[:7]: l 0 0 0 0 0 0 7 0`.slice(1))
  const saved = serialize(lone, lone.scheduling)
  assert.equal(saved, `
Q:: early

Q:; outer ::: middle :::: inner[:2][:1]

[:2]: l 0 0 0 0 0 0 7 0
`.slice(1))
  assert.equal(card_lines(parse(saved)), `
[:-1]: n 0 0 0 0 0 0 0 0
[:-2]: n 0 0 0 0 0 0 0 0
[:2]: l 0 0 0 0 0 0 7 0`.slice(1))
}

/**
 * A continuation never owns a reference: not over its first cloze's, not when the first cloze has none, not where
 * only continuations end, and not when the first cloze's reference has no definition. Saving removes such
 * references with their definitions.
 */
export function test_continuations_never_own_references() {
  const over_first = parse(`
Q:: first[:8]

Q:; second[:9]

[:8]: l 20261010120100 0 20261010120000 2.3 5 1 2 0
[:9]: n 0 0 0 0 0 0 0 0
`.slice(1))
  assert.equal(card_lines(over_first), '[:8]: l 20261010120100 0 20261010120000 2.3 5 1 2 0')
  assert.equal(render(over_first.events), `
<p>Q: <span class="cloze" data-ordinal="1" data-card="[:8]: l 20261010120100 0 20261010120000 2.3 5 1 2 0">first</span></p>
<p>Q: <span class="cloze" data-ordinal="1" data-card="[:8]: l 20261010120100 0 20261010120000 2.3 5 1 2 0">second</span></p>
`.slice(1))
  assert.equal(serialize(over_first, over_first.scheduling), `
Q:: first[:1]

Q:; second

[:1]: l 20261010120100 0 20261010120000 2.3 5 1 2 0
`.slice(1))

  const first_has_none = parse(`
Q:: first

Q:; second[:8]

[:8]: k 20261012040000 7 20261005120000 8.5 4.2 0 10 1
`.slice(1))
  assert.equal(card_lines(first_has_none), '[:-1]: n 0 0 0 0 0 0 0 0')
  assert.equal(serialize(first_has_none, first_has_none.scheduling), `
Q:: first

Q:; second
`.slice(1))

  const only_continuations = parse(`
Q:: first

Q::: other

Q:; outer ::; inner[:9]

[:9]: l 0 0 0 0 0 0 9 0
`.slice(1))
  assert.equal(card_lines(only_continuations), `
[:-1]: n 0 0 0 0 0 0 0 0
[:-2]: n 0 0 0 0 0 0 0 0`.slice(1))
  assert.equal(serialize(only_continuations, only_continuations.scheduling), `
Q:: first

Q::: other

Q:; outer ::; inner
`.slice(1))

  // The first cloze keeps the reference written for it, though no definition matches it.
  const unknown_first = parse(`
Q:: first[:99]

Q:; second[:7]

[:7]: n 0 0 0 0 0 0 0 0
`.slice(1))
  assert.equal(card_lines(unknown_first), '[:-1]: n 0 0 0 0 0 0 0 0')
  assert.equal(serialize(unknown_first, unknown_first.scheduling), `
Q:: first[:1]

Q:; second
`.slice(1))
}

/**
 * A hint whose reference stands where only a continuation ends, after its closer or on a line after its code,
 * belongs to no card: it is parsed as written but never applied, and saving removes it with the reference.
 */
export function test_a_hint_referenced_from_a_continuation_is_never_applied() {
  const after_closer = parse(`
Q::> first<::

Q:;> second<::[:8]

[:8]: ! 0 0 0 0 0 0 0 0
`.slice(1))
  assert.equal(card_lines(after_closer), '[:-1]: n 0 0 0 0 0 0 0 0')
  assert.equal(serialize_card(after_closer.definitions[0].scheduling), '[:8]: ! 0 0 0 0 0 0 0 0')
  assert.equal(serialize(after_closer, after_closer.scheduling), `
Q::> first<::

Q:;> second<::
`.slice(1))

  const after_code = parse(`
Q:: first

Q:;

\`\`\`txt
second
\`\`\`
[:8]

[:8]: ! 0 0 0 0 0 0 0 0
`.slice(1))
  assert.equal(card_lines(after_code), '[:-1]: n 0 0 0 0 0 0 0 0')
  assert.equal(serialize_card(after_code.definitions[0].scheduling), '[:8]: ! 0 0 0 0 0 0 0 0')
  assert.equal(serialize(after_code, after_code.scheduling), `
Q:: first

Q:;

\`\`\`txt
second
\`\`\`
`.slice(1))
}

/** A reference away from every cloze's end owns nothing, renders nothing, and saving removes it with its definition. */
export function test_a_reference_away_from_every_cloze_end_owns_nothing() {
  const parsed = parse(`
Stray[:8]

[:9]

Q:: early[:8] tail

[:8]: k 20261012040000 7 20261005120000 8.5 4.2 0 10 1
`.slice(1))
  assert.equal(card_lines(parsed), '[:-1]: n 0 0 0 0 0 0 0 0')
  assert.equal(render(parsed.events), `
<p>Stray</p>
<p>Q: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">early tail</span></p>
`.slice(1))
  assert.equal(serialize(parsed, parsed.scheduling), `
Stray

Q:: early tail
`.slice(1))
}

/**
 * A reference identifier used twice gives its definition to the first card only; the second card is new, and keeps
 * a reference without a definition through saving.
 */
export function test_a_repeated_reference_gives_its_definition_to_the_first_card_only() {
  const parsed = parse(`
A:: first[:7]

B:: second[:7]

[:7]: k 20261012040000 7 20261005120000 8.5 4.2 0 10 1
`.slice(1))
  assert.equal(card_lines(parsed), `
[:7]: k 20261012040000 7 20261005120000 8.5 4.2 0 10 1
[:-2]: n 0 0 0 0 0 0 0 0`.slice(1))
  const saved = serialize(parsed, parsed.scheduling)
  assert.equal(saved, `
A:: first[:1]

B:: second[:2]

[:1]: k 20261012040000 7 20261005120000 8.5 4.2 0 10 1
`.slice(1))
  assert.equal(card_lines(parse(saved)), `
[:1]: k 20261012040000 7 20261005120000 8.5 4.2 0 10 1
[:-2]: n 0 0 0 0 0 0 0 0`.slice(1))
}

/**
 * An explicit close that Markdown delays, or makes early, keeps the reference written after the closer: the card
 * keeps its definition, through a save and reload, while the late closer shows as text.
 */
export function test_a_delayed_or_early_close_keeps_the_reference_written_after_the_closer() {
  const delayed = parse(`
Q::>before **inside<::[:7] after<::** outside

[:7]: l 0 0 0 0 0 0 1 0`.slice(1))
  assert.equal(card_lines(delayed), '[:7]: l 0 0 0 0 0 0 1 0')
  assert.equal(render(delayed.events), `
<p>Q<span class="cloze" data-ordinal="1" data-card="[:7]: l 0 0 0 0 0 0 1 0">before <strong>inside after&lt;::</strong></span> outside</p>
`.slice(1))

  // The paragraph ends the cloze before its closer; the reference at that end stays owned.
  const early = parse(`
Q::>first[:7]

<::

[:7]: l 0 0 0 0 0 0 1 0`.slice(1))
  assert.equal(card_lines(early), '[:7]: l 0 0 0 0 0 0 1 0')
  const saved = serialize(early, early.scheduling)
  const reloaded = parse(saved)
  assert.equal(card_lines(reloaded), '[:1]: l 0 0 0 0 0 0 1 0')
  assert.equal(render(reloaded.events), `
<p>Q<span class="cloze" data-ordinal="1" data-card="[:1]: l 0 0 0 0 0 0 1 0">first</span></p>
<p>&lt;::</p>
`.slice(1))
  assert.equal(serialize(reloaded, reloaded.scheduling), saved)
}

// Run every test_ function above as a test named after it.
for (const [name, fn] of Object.entries(tests)) if (name.startsWith('test_')) test(name, fn)
