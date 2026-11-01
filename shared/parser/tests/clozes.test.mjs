// Cloze syntax and its HTML (SYNTAX.md, "Clozes" and "HTML"): markers, where clozes end, nesting and continuations.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parse, render } from '../src/index.ts'
import * as tests from './clozes.test.mjs'

/** The source each cloze spans, in the order the clozes open: shows which side of a boundary a cloze ends on. */
function cloze_sources(parsed) {
  return parsed.clozes.map(cloze => parsed.source.slice(cloze.start.offset, cloze.end.offset))
}

/**
 * The types of closing tokens that do not close the latest opening token of their list, block tokens or an inline
 * token's children, and of opening tokens never closed; empty when balanced.
 */
function unbalanced(tokens) {
  const open = []
  const wrong = []
  for (const token of tokens) {
    if (token.nesting === 1) open.push(token)
    else if (token.nesting === -1 && open.pop()?.type.replace(/_open$/, '') !== token.type.replace(/_close$/, '')) wrong.push(token.type)
    if (token.type === 'inline') wrong.push(...unbalanced(token.children))
  }
  return [...wrong, ...open.map(token => token.type)]
}

/** An implicit inline cloze runs to the end of its paragraph, across soft line breaks; an opener starting it too. */
export function test_implicit_inline_cloze_runs_to_its_paragraph_end_across_soft_line_breaks() {
  const after_text = parse(`
Q:: answer
next`.slice(1))
  assert.equal(render(after_text), `
<p>Q: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">answer
next</span></p>`.slice(1))
  assert.deepEqual(cloze_sources(after_text), ['answer\nnext'])

  const at_start = parse(`
:: alpha
beta

outside`.slice(1))
  assert.equal(render(at_start), `
<p>: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">alpha
beta</span></p>
<p>outside</p>`.slice(1))
}

/** An implicit inline cloze ends before a hard break, of a backslash or of trailing spaces; nested clozes too. */
export function test_implicit_inline_cloze_ends_before_a_hard_break() {
  const backslash = parse(`
Q:: answer\\
next`.slice(1))
  assert.equal(render(backslash), `
<p>Q: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">answer</span><br>
next</p>`.slice(1))
  assert.deepEqual(cloze_sources(backslash), ['answer'])

  const spaces_crlf = parse(`
Q:: answer\x20\x20\r
next`.slice(1))
  assert.equal(render(spaces_crlf), `
<p>Q: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">answer</span><br>
next</p>`.slice(1))
  assert.deepEqual(cloze_sources(spaces_crlf), ['answer'])

  const at_start = parse(`
:: answer\x20\x20
next`.slice(1))
  assert.equal(render(at_start), `
<p>: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">answer</span><br>
next</p>`.slice(1))

  const nested = parse(`
Q:: outer ::: inner\x20\x20
next`.slice(1))
  assert.equal(render(nested), `
<p>Q: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">outer : <span class="cloze" data-ordinal="2" data-card="[:-2]: n 0 0 0 0 0 0 0 0">inner</span></span><br>
next</p>`.slice(1))
  assert.deepEqual(cloze_sources(nested), ['outer ::: inner', 'inner'])
  assert.deepEqual(unbalanced(nested.tokens), [])
}

/**
 * A hard break inside an element, or inside an explicit cloze within the implicit one, does not end the implicit
 * cloze: it closes where the element or explicit cloze lets it.
 */
export function test_a_hard_break_inside_an_element_or_explicit_cloze_does_not_end_an_implicit_cloze() {
  const in_emphasis = parse(`
Q:: before **inside\x20\x20
after** outside`.slice(1))
  assert.equal(render(in_emphasis), `
<p>Q: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">before <strong>inside<br>
after</strong></span> outside</p>`.slice(1))
  assert.deepEqual(unbalanced(in_emphasis.tokens), [])

  const in_explicit_child = parse(`
Q:: implicit :::>explicit\x20\x20
after<:: outside`.slice(1))
  assert.equal(render(in_explicit_child), `
<p>Q: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">implicit <span class="cloze" data-ordinal="2" data-card="[:-2]: n 0 0 0 0 0 0 0 0">explicit<br>
after</span></span> outside</p>`.slice(1))
  assert.deepEqual(unbalanced(in_explicit_child.tokens), [])
}

/** An explicit cloze runs through a hard break to its closer, keeping the spaces after its opener. */
export function test_an_explicit_cloze_runs_through_hard_breaks_to_its_closer() {
  const parsed = parse(`
Q::> answer\x20\x20
next<:: end`.slice(1))
  assert.equal(render(parsed), `
<p>Q<span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0"> answer<br>
next</span> end</p>`.slice(1))
  assert.deepEqual(cloze_sources(parsed), [' answer  \nnext<::'])
}

/**
 * An opener at the end of its block's text opens a block cloze around the next block, whole: a paragraph with its
 * line breaks, a list, a code block that runs to the end of its quote. A reference after the opener leaves it at
 * the end of its text, and is hidden.
 */
export function test_a_block_cloze_wraps_the_next_block() {
  const paragraph = parse(`
Q::

answer
next`.slice(1))
  assert.equal(render(paragraph), `
<p>Q:</p>
<div class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">
<p>answer
next</p>
</div>`.slice(1))
  assert.deepEqual(cloze_sources(paragraph), ['answer\nnext'])

  const hard_break = parse(`
Q::

answer\x20\x20
next`.slice(1))
  assert.equal(render(hard_break), `
<p>Q:</p>
<div class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">
<p>answer<br>
next</p>
</div>`.slice(1))
  assert.deepEqual(cloze_sources(hard_break), ['answer  \nnext'])

  assert.equal(render(parse(`
A list:: [:9]

- x`.slice(1))), `
<p>A list:</p>
<div class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">
<ul>
<li>x</li>
</ul>
</div>`.slice(1))

  assert.equal(render(parse(`
> Q::
>
> \`\`\`txt
> answer`.slice(1))), `
<blockquote>
<p>Q:</p>
<div class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">
<pre><code class="language-txt">answer</code></pre>
</div>
</blockquote>`.slice(1))
}

/**
 * A paragraph holding only an implicit opener shows its colon, and its cloze wraps the next block. Without a next
 * block there is no card.
 */
export function test_an_opener_alone_in_its_paragraph_shows_its_colon() {
  const alone = parse('::')
  assert.equal(render(alone), '<p>:</p>')
  assert.deepEqual(alone.scheduling, [])

  assert.equal(render(parse(`
::

answer\x20\x20
next`.slice(1))), `
<p>:</p>
<div class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">
<p>answer<br>
next</p>
</div>`.slice(1))

  const list = parse(`
::

- first
  - child
- second

outside`.slice(1))
  assert.equal(render(list), `
<p>:</p>
<div class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">
<ul>
<li>first
<ul>
<li>child</li>
</ul>
</li>
<li>second</li>
</ul>
</div>
<p>outside</p>`.slice(1))
  assert.deepEqual(unbalanced(list.tokens), [])
}

/**
 * An opener ending a line inside a paragraph is not at the end of its text: its inline cloze starts with the line
 * ending and runs to the paragraph end, also when the opener is explicit or starts the paragraph, and around a
 * nested inline cloze on the next line.
 */
export function test_an_opener_ending_a_line_inside_a_paragraph_opens_an_inline_cloze() {
  assert.equal(render(parse(`
Q::
answer

later`.slice(1))), `
<p>Q:<span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">
answer</span></p>
<p>later</p>`.slice(1))

  assert.equal(render(parse(`
::
answer`.slice(1))), `
<p>:<span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">
answer</span></p>`.slice(1))

  assert.equal(render(parse(`
Question
::
Answer
and more`.slice(1))), `
<p>Question
:<span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">
Answer
and more</span></p>`.slice(1))

  assert.equal(render(parse(`
Text
::>
more<:: after`.slice(1))), `
<p>Text
<span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">
more</span> after</p>`.slice(1))

  assert.equal(render(parse(`
A::\x20
B:: beta[:1]`.slice(1))), `
<p>A:<span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">
B: <span class="cloze" data-ordinal="2" data-card="[:-2]: n 0 0 0 0 0 0 0 0">beta</span></span></p>`.slice(1))
}

/**
 * Marker spellings: a closer may end in a semicolon and need not match its opener's symbols; a tab may follow an
 * implicit opener; a `<` starting no closer is left to Markdown, here an autolink.
 */
export function test_marker_spellings() {
  assert.equal(render(parse('Q ::>a<:; and ::::>b<::; end')),
    '<p>Q <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">a</span> and <span class="cloze" data-ordinal="2" data-card="[:-2]: n 0 0 0 0 0 0 0 0">b</span> end</p>')
  assert.equal(render(parse('Q::\tanswer')),
    '<p>Q:\t<span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">answer</span></p>')
  assert.equal(render(parse('Visit <https://example.com>.')),
    '<p>Visit <a href="https://example.com">https://example.com</a>.</p>')
}

/** srmd syntax in a heading is literal text: markers, closers and references, also after closing hashes. */
export function test_srmd_syntax_in_headings_is_literal_text() {
  const markers = parse('## Q:: a ::>b<::')
  assert.equal(render(markers), '<h2>Q:: a ::&gt;b&lt;::</h2>')
  assert.deepEqual(markers.scheduling, [])
  assert.equal(render(parse('# :: heading')), '<h1>:: heading</h1>')
  // Closing hashes stay heading syntax, and a reference after them makes them text.
  assert.equal(render(parse(`
# Q:: ###

answer`.slice(1))), `
<h1>Q::</h1>
<p>answer</p>`.slice(1))
  assert.equal(render(parse('# Q:: answer ##[:1]')), '<h1>Q:: answer ##[:1]</h1>')
}

/** A paragraph holding only explicit markers renders nothing; a closer that closes nothing is text and shows. */
export function test_a_paragraph_holding_only_explicit_markers_renders_nothing() {
  assert.equal(render(parse(`
::>

answer

<::`.slice(1))), `
<div class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">
<p>answer</p>
</div>`.slice(1))

  assert.equal(render(parse(`
Q::>first

<::`.slice(1))), `
<p>Q<span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">first</span></p>
<p>&lt;::</p>`.slice(1))
}

/** An explicit block cloze holds the blocks up to its closer; without a closer, the rest of its container. */
export function test_an_explicit_block_cloze_holds_the_blocks_up_to_its_closer() {
  const closed = parse(`
Q::>

- first
- second

<::`.slice(1))
  assert.equal(render(closed), `
<p>Q</p>
<div class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">
<ul>
<li>first</li>
<li>second</li>
</ul>
</div>`.slice(1))
  assert.deepEqual(unbalanced(closed.tokens), [])

  assert.equal(render(parse(`
Q::>

first

second`.slice(1))), `
<p>Q</p>
<div class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">
<p>first</p>
<p>second</p>
</div>`.slice(1))
}

/**
 * A closer inside an element, straddling its boundary, closes its explicit cloze only after that element: emphasis,
 * a link with its destination. Successive closers skip clozes already waiting, and delayed inline and block
 * closes unwind in nesting order.
 */
export function test_a_closer_inside_an_element_closes_its_cloze_after_the_element() {
  const emphasis = parse('Q::>straddling **emphasis<:: boundaries** after')
  assert.equal(render(emphasis),
    '<p>Q<span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">straddling <strong>emphasis boundaries</strong></span> after</p>')
  assert.deepEqual(unbalanced(emphasis.tokens), [])

  const link = parse('Q::>straddling [link<:: boundaries](https://example.com) after')
  assert.equal(render(link),
    '<p>Q<span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">straddling <a href="https://example.com">link boundaries</a></span> after</p>')
  assert.deepEqual(unbalanced(link.tokens), [])

  const successive = parse('Q::>outer :::>inner **deep<:: tail<:: more** outside')
  assert.equal(render(successive),
    '<p>Q<span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">outer <span class="cloze" data-ordinal="2" data-card="[:-2]: n 0 0 0 0 0 0 0 0">inner <strong>deep tail more</strong></span></span> outside</p>')
  assert.deepEqual(unbalanced(successive.tokens), [])

  const inline_in_block = parse(`
Q::>

:::>inner **deep<:: tail** after<::

outside`.slice(1))
  assert.equal(render(inline_in_block), `
<p>Q</p>
<div class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">
<p><span class="cloze" data-ordinal="2" data-card="[:-2]: n 0 0 0 0 0 0 0 0">inner <strong>deep tail</strong></span> after</p>
</div>
<p>outside</p>`.slice(1))
  assert.deepEqual(unbalanced(inline_in_block.tokens), [])
}

/**
 * An explicit cloze renders up to the end of the element containing its opener at the latest: its paragraph,
 * emphasis, a list item, a quote holding a pending opener. A closer after its paragraph closes nothing, so it is text;
 * one later in the paragraph than its emphasis still closes it, though its rendering ended with the emphasis.
 */
export function test_an_explicit_cloze_ends_with_its_container_and_a_later_closer_is_text() {
  const paragraph = parse(`
Q::>first

second<:: after`.slice(1))
  assert.equal(render(paragraph), `
<p>Q<span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">first</span></p>
<p>second&lt;:: after</p>`.slice(1))
  assert.deepEqual(unbalanced(paragraph.tokens), [])

  // The inner cloze renders up to the end of its emphasis, yet the first closer, after it, is still the inner cloze's,
  // the latest opened, and the second the outer one's.
  const emphasis = parse('Q::>outer **:::>inner** after<:: still outer<:: outside')
  assert.equal(render(emphasis),
    '<p>Q<span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">outer <strong><span class="cloze" data-ordinal="2" data-card="[:-2]: n 0 0 0 0 0 0 0 0">inner</span></strong> after still outer</span> outside</p>')
  assert.deepEqual(emphasis.groups.map(group => group.key), ['t47', 't32'])
  assert.deepEqual(unbalanced(emphasis.tokens), [])

  const list_item = parse(`
- Q::>

  answer
- next<:: outside`.slice(1))
  assert.equal(render(list_item), `
<ul>
<li>
<p>Q</p>
<div class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">
<p>answer</p>
</div>
</li>
<li>
<p>next&lt;:: outside</p>
</li>
</ul>`.slice(1))
  assert.deepEqual(unbalanced(list_item.tokens), [])

  const quote = parse(`
> Q::>

outside<:: after`.slice(1))
  assert.equal(render(quote), `
<blockquote>
<p>Q</p>
</blockquote>
<p>outside&lt;:: after</p>`.slice(1))
  assert.deepEqual(unbalanced(quote.tokens), [])
}

/** A pending opener's answer must be in its own container: it cannot escape a block quote or a list item. */
export function test_a_pending_opener_stays_in_its_container() {
  const quote = parse(`
> Q::

outside`.slice(1))
  assert.equal(render(quote), `
<blockquote>
<p>Q:</p>
</blockquote>
<p>outside</p>`.slice(1))
  assert.deepEqual(quote.scheduling, [])

  const list_item = parse(`
- Q::
- outside`.slice(1))
  assert.equal(render(list_item), `
<ul>
<li>Q:</li>
<li>outside</li>
</ul>`.slice(1))
  assert.deepEqual(list_item.scheduling, [])
}

/**
 * Groups nest: at a paragraph start, inside a block cloze, sharing an end, explicitly, and a list item's group
 * inside the list's. Each group is a card with its own ordinal.
 */
export function test_groups_nest() {
  const at_start = parse(':: ::: inner')
  assert.equal(render(at_start),
    '<p>: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">: <span class="cloze" data-ordinal="2" data-card="[:-2]: n 0 0 0 0 0 0 0 0">inner</span></span></p>')
  assert.deepEqual(cloze_sources(at_start), ['::: inner', 'inner'])

  const in_block = parse(`
Q::

::: first\x20\x20
next`.slice(1))
  assert.equal(render(in_block), `
<p>Q:</p>
<div class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">
<p>: <span class="cloze" data-ordinal="2" data-card="[:-2]: n 0 0 0 0 0 0 0 0">first</span><br>
next</p>
</div>`.slice(1))
  assert.deepEqual(cloze_sources(in_block), ['::: first  \nnext', 'first'])

  assert.equal(render(parse('Q:: outer ::: inner[:1][:2]')),
    '<p>Q: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">outer : <span class="cloze" data-ordinal="2" data-card="[:-2]: n 0 0 0 0 0 0 0 0">inner</span></span></p>')
  assert.equal(render(parse('Q::> outer :::> inner <::[:2] tail <::[:1]')),
    '<p>Q<span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0"> outer <span class="cloze" data-ordinal="2" data-card="[:-2]: n 0 0 0 0 0 0 0 0"> inner </span> tail </span></p>')

  assert.equal(render(parse(`
Q::

- first::: answer[:1][:2]`.slice(1))), `
<p>Q:</p>
<div class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">
<ul>
<li>first: <span class="cloze" data-ordinal="2" data-card="[:-2]: n 0 0 0 0 0 0 0 0">answer</span></li>
</ul>
</div>`.slice(1))
}

/**
 * A continuation joins the latest group of its level, keeping that card's ordinal next to a new nested group. Inside
 * its own group's open cloze it continues nothing and is text.
 */
export function test_continuations_join_the_latest_group_of_their_level() {
  assert.equal(render(parse(`
Q::> first <::[:1]

Q:; outer ::: inner[:2]`.slice(1))), `
<p>Q<span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0"> first </span></p>
<p>Q: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">outer : <span class="cloze" data-ordinal="2" data-card="[:-2]: n 0 0 0 0 0 0 0 0">inner</span></span></p>`.slice(1))

  const own_group = parse('Q:: first :; nested')
  assert.equal(render(own_group),
    '<p>Q: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">first :; nested</span></p>')
  assert.deepEqual(unbalanced(own_group.tokens), [])
}

/**
 * Table cells hold inline clozes, a group and its continuation here inside the table's block cloze. An opener ending
 * a cell has no next block in it, so it opens nothing, implicit or explicit.
 */
export function test_table_cells_hold_inline_clozes_only() {
  assert.equal(render(parse(`
Q::

| A | B |
| - | - |
| ::: x[:2]  | ::; y |[:1]`.slice(1))), `
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
<td>: <span class="cloze" data-ordinal="2" data-card="[:-2]: n 0 0 0 0 0 0 0 0">x</span></td>
<td>: <span class="cloze" data-ordinal="2" data-card="[:-2]: n 0 0 0 0 0 0 0 0">y</span></td>
</tr>
</tbody>
</table>
</div>`.slice(1))

  assert.equal(render(parse(`
| Q:: | B |
| - | - |
| x | y |`.slice(1))), `
<table>
<thead>
<tr>
<th>Q:</th>
<th>B</th>
</tr>
</thead>
<tbody>
<tr>
<td>x</td>
<td>y</td>
</tr>
</tbody>
</table>`.slice(1))

  const body_cells = parse(`
| A | B |
| - | - |
| Q:: | answer |
| Q::> | answer <:: |`.slice(1))
  assert.equal(render(body_cells), `
<table>
<thead>
<tr>
<th>A</th>
<th>B</th>
</tr>
</thead>
<tbody>
<tr>
<td>Q:</td>
<td>answer</td>
</tr>
<tr>
<td>Q</td>
<td>answer &lt;::</td>
</tr>
</tbody>
</table>`.slice(1))
  assert.deepEqual(body_cells.scheduling, [])
}

/** Markdown inside and around a cloze renders as usual: strong emphasis, links and code in it, a cloze in emphasis. */
export function test_markdown_inside_and_around_clozes_renders_as_usual() {
  assert.equal(render(parse('Q:: **bold**[:1]')),
    '<p>Q: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0"><strong>bold</strong></span></p>')
  assert.equal(render(parse('Q:: [link](target)[:1]')),
    '<p>Q: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0"><a href="target">link</a></span></p>')
  assert.equal(render(parse('Q:: `answer`[:1]')),
    '<p>Q: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0"><code>answer</code></span></p>')
  assert.equal(render(parse('**:: answer**')),
    '<p><strong>: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">answer</span></strong></p>')
}

/** A backslash escapes one marker character, as Markdown escapes any punctuation: `\:::` still holds a `::` opener. */
export function test_a_backslash_escapes_one_marker_character() {
  const escaped = parse(String.raw`Q\:: answer and \<\:: literal`)
  assert.equal(render(escaped), '<p>Q:: answer and &lt;:: literal</p>')
  assert.deepEqual(escaped.scheduling, [])

  assert.equal(render(parse(String.raw`Q\::: answer`)),
    '<p>Q:: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">answer</span></p>')
}

// Run every test_ function above as a test named after it.
for (const [name, fn] of Object.entries(tests)) if (name.startsWith('test_')) test(name, fn)
