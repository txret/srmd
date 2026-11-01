// Card definitions (SYNTAX.md, "Card definitions"): their fields, where they stand, and the problems a save would fix.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parse, render, serialize, serialize_card } from '../src/index.ts'
import * as tests from './definitions.test.mjs'

/** Each card of a parse as its definition line, in card order; `[:-n]` marks card n without a definition. */
function card_lines(parsed) {
  return parsed.scheduling.map(serialize_card).join('\n')
}

/** The card of `Q:: a[:1]` followed by a definition line: that line in full form if it is a valid definition. */
function card_with(line) {
  return serialize_card(parse(`Q:: a[:1]\n\n${line}\n`).scheduling[0])
}
const not_a_definition = '[:-1]: n 0 0 0 0 0 0 0 0'

/**
 * A definition needs a state; the other fields are positional and default to zero. Fields are separated by spaces or
 * tabs, decimal fields accept integers, a hint state stays as written, and spaces or tabs may trail.
 */
export function test_definition_fields() {
  assert.equal(card_with('[:1]: k'), '[:1]: k 0 0 0 0 0 0 0 0')
  assert.equal(card_with('[:1]:\tk  20261014040000\t7'), '[:1]: k 20261014040000 7 0 0 0 0 0 0')
  assert.equal(card_with('[:1]: l 20261014040000 0.25 20261013040000 3 4.5'), '[:1]: l 20261014040000 0.25 20261013040000 3 4.5 0 0 0')
  assert.equal(card_with('[:1]: 2w'), '[:1]: 2w 0 0 0 0 0 0 0 0')
  assert.equal(card_with('[:1]: l 0 0 0 0 0 0 1 0  \t'), '[:1]: l 0 0 0 0 0 0 1 0')
}

/** A line breaking any field rule is no definition but ordinary text, which matches no card. */
export function test_invalid_definitions_are_text() {
  assert.equal(card_with('[:1]: 0d'), not_a_definition)
  assert.equal(card_with('[:1]: k 2026101404'), not_a_definition)
  assert.equal(card_with('[:1]: k 0 0 0 0 0 1.5'), not_a_definition)
  assert.equal(card_with('[:1]: k 0 0 0 0 0 0 0 0 0'), not_a_definition)
  assert.equal(card_with('[:1]:'), not_a_definition)
  assert.equal(render(parse('[:8]: nope 0 0 0 0 0 0 0 0')), '<p>[:8]: nope 0 0 0 0 0 0 0 0</p>')
  assert.equal(render(parse('[:8]: n 0 0 0 0 0 0 0 0 99')), '<p>[:8]: n 0 0 0 0 0 0 0 0 99</p>')
}

/**
 * Definitions stand where link reference definitions can: indented up to three spaces, four making code; in a
 * quote; among link definitions. No space is needed after the label's colon. They render nothing.
 */
export function test_definitions_stand_where_link_definitions_can() {
  const indented = parse(`
   [:8]:l 0 0 0 0 0 0 1 0

Q:: answer[:8]`.slice(1))
  assert.equal(card_lines(indented), '[:8]: l 0 0 0 0 0 0 1 0')
  assert.equal(serialize(indented, indented.scheduling), `
   [:1]: l 0 0 0 0 0 0 1 0

Q:: answer[:1]`.slice(1))

  const code = parse('    [:8]: n 0 0 0 0 0 0 0 0')
  assert.equal(render(code), `
<pre><code>[:8]: n 0 0 0 0 0 0 0 0
</code></pre>`.slice(1))
  assert.deepEqual(code.definitions, [])

  const quoted = parse(`
> [:8]: l 0 0 0 0 0 0 1 0
>
> Q:: answer[:8]`.slice(1))
  assert.equal(card_lines(quoted), '[:8]: l 0 0 0 0 0 0 1 0')
  assert.equal(render(quoted), `
<blockquote>
<p>Q: <span class="cloze" data-ordinal="1" data-card="[:8]: l 0 0 0 0 0 0 1 0">answer</span></p>
</blockquote>`.slice(1))
  assert.equal(serialize(quoted, quoted.scheduling), `
> [:1]: l 0 0 0 0 0 0 1 0
>
> Q:: answer[:1]`.slice(1))

  const with_links = parse(`
[site]: https://example.com
[:8]: l 0 0 0 0 0 0 1 0

Q:: [answer][site][:8]`.slice(1))
  assert.equal(card_lines(with_links), '[:8]: l 0 0 0 0 0 0 1 0')
  assert.equal(render(with_links),
    '<p>Q: <span class="cloze" data-ordinal="1" data-card="[:8]: l 0 0 0 0 0 0 1 0"><a href="https://example.com">answer</a></span></p>')
  assert.equal(serialize(with_links, with_links.scheduling), `
[site]: https://example.com
[:1]: l 0 0 0 0 0 0 1 0

Q:: [answer][site][:1]`.slice(1))
}

/**
 * A definition is one line, and cannot interrupt a paragraph: right after paragraph text it is text. A definition
 * line ending early is a definition with zero fields after, and the line after it is a paragraph.
 */
export function test_a_definition_is_one_line_and_cannot_interrupt_a_paragraph() {
  assert.equal(render(parse(`
Text
[:8]: n 0 0 0 0 0 0 0 0`.slice(1))), `
<p>Text
[:8]: n 0 0 0 0 0 0 0 0</p>`.slice(1))

  const wrapped = parse(`
Q:: answer[:7]

[:7]: n 0 0 0
0 0 0 0 0
Text`.slice(1))
  assert.equal(card_lines(wrapped), '[:7]: n 0 0 0 0 0 0 0 0')
  assert.equal(render(wrapped), `
<p>Q: <span class="cloze" data-ordinal="1" data-card="[:7]: n 0 0 0 0 0 0 0 0">answer</span></p>
<p>0 0 0 0 0
Text</p>`.slice(1))

  assert.equal(render(parse(`
[:8]: n 0 0 0

0 0 0 0 0`.slice(1))), '<p>0 0 0 0 0</p>')
}

/**
 * Definitions a save would remove are reported in source order with their line: those no card claims, and repeats
 * of an identifier, of which the first counts. After the save there are none.
 */
export function test_definitions_a_save_would_remove_are_reported() {
  const parsed = parse(`
Q:: a[:1]

Q:: b

[:3]: k 20261014040000 7 20261007120000 3 5 0 2 0
[:1]: k 20261014040000 7 20261007120000 3 5 0 2 0
[:1]: l 0 0 0 0 0 0 0 0
[:2]: k 20261014040000 7 20261007120000 3 5 0 2 0
`.slice(1))
  assert.deepEqual(parsed.problems, [
    { kind: 'unmatched_definition', ref: 3, line: 5 },
    { kind: 'duplicate_definition', ref: 1, line: 7 },
    { kind: 'unmatched_definition', ref: 2, line: 8 }
  ])
  assert.equal(card_lines(parsed), `
[:1]: k 20261014040000 7 20261007120000 3 5 0 2 0
[:-2]: n 0 0 0 0 0 0 0 0`.slice(1))
  const saved = serialize(parsed, parsed.scheduling)
  assert.equal(saved, `
Q:: a[:1]

Q:: b

[:1]: k 20261014040000 7 20261007120000 3 5 0 2 0
`.slice(1))
  assert.deepEqual(parse(saved).problems, [])
}

/**
 * FSRS parameters that JavaScript spells with an exponent, such as `1e-7`, save in the definition grammar's plain
 * decimals, and read back as the same card.
 */
export function test_numbers_beyond_plain_javascript_spelling_save_as_plain_decimals() {
  const parsed = parse(`
Q:: a[:1]

[:1]: k 20261014040000 7 20261007120000 0.0000001 1234567890123456789012 0 10 1
`.slice(1))
  assert.deepEqual([parsed.scheduling[0].stability, parsed.scheduling[0].difficulty], [1e-7, 1.2345678901234568e21])
  const saved = serialize(parsed, parsed.scheduling)
  assert.equal(saved, `
Q:: a[:1]

[:1]: k 20261014040000 7 20261007120000 0.0000001 1234567890123456800000 0 10 1
`.slice(1))
  assert.deepEqual(parse(saved).scheduling, parsed.scheduling)
}

/** data-card shows a definition in canonical form, while the source keeps the author's spacing and decimals. */
export function test_data_card_shows_a_definition_in_canonical_form() {
  const source = `
Q:: answer[:1]

[:1]: k  20261012040000 7 20261005120000 8.50  4.20 0 10 1
`.slice(1)
  const parsed = parse(source)
  assert.equal(render(parsed), `
<p>Q: <span class="cloze" data-ordinal="1" data-card="[:1]: k 20261012040000 7 20261005120000 8.5 4.2 0 10 1">answer</span></p>`.slice(1))
  assert.equal(parsed.source, source)
}

/**
 * Parsing keeps hint states and their other fields exactly as written, choosing no day: rendering shows them, and
 * saving them unchanged writes the note unchanged. Only the scheduler resolves hints.
 */
export function test_hints_are_kept_as_written(t) {
  t.mock.method(Math, 'random', () => assert.fail('parsing must not choose a review day'))
  const source = `
A:: a[:1]

B:: b[:2]

C:: c[:3]

D:: d[:4]

[:1]: ! 20000101040000 99 19991225120000 12.5 5.1 3 10 2
[:2]: 7d 20000101040000 99 19991225120000 12.5 5.1 3 10 2
[:3]: 2w 20000101040000 99 19991225120000 12.5 5.1 3 10 2
[:4]: 1m 20000101040000 99 19991225120000 12.5 5.1 3 10 2
`.slice(1)
  const parsed = parse(source)
  assert.deepEqual(parsed.scheduling[0], {
    ref: 1, state: '!', due: '20000101040000', scheduled_days: 99, last_review: '19991225120000', stability: 12.5,
    difficulty: 5.1, learning_steps: 3, reps: 10, lapses: 2
  })
  assert.equal(card_lines(parsed), `
[:1]: ! 20000101040000 99 19991225120000 12.5 5.1 3 10 2
[:2]: 7d 20000101040000 99 19991225120000 12.5 5.1 3 10 2
[:3]: 2w 20000101040000 99 19991225120000 12.5 5.1 3 10 2
[:4]: 1m 20000101040000 99 19991225120000 12.5 5.1 3 10 2`.slice(1))
  assert.equal(render(parsed), `
<p>A: <span class="cloze" data-ordinal="1" data-card="[:1]: ! 20000101040000 99 19991225120000 12.5 5.1 3 10 2">a</span></p>
<p>B: <span class="cloze" data-ordinal="2" data-card="[:2]: 7d 20000101040000 99 19991225120000 12.5 5.1 3 10 2">b</span></p>
<p>C: <span class="cloze" data-ordinal="3" data-card="[:3]: 2w 20000101040000 99 19991225120000 12.5 5.1 3 10 2">c</span></p>
<p>D: <span class="cloze" data-ordinal="4" data-card="[:4]: 1m 20000101040000 99 19991225120000 12.5 5.1 3 10 2">d</span></p>`.slice(1))
  assert.equal(serialize(parsed, parsed.scheduling), source)
}

// Run every test_ function above as a test named after it.
for (const [name, fn] of Object.entries(tests)) if (name.startsWith('test_')) test(name, fn)
