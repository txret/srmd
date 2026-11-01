// The parser's API contracts (ARCHITECTURE.md, "Parser"): what parse() returns, how render() and serialize() use it.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import MarkdownIt from 'markdown-it'
import { parse, render, serialize, serialize_card, srmd_plugin } from '../src/index.ts'
import * as tests from './api.test.mjs'

/** Each card of a parse as its definition line, in card order; `[:-n]` marks card n without a definition. */
function card_lines(parsed) {
  return parsed.scheduling.map(serialize_card).join('\n')
}

/**
 * What is wrong with a parse, one sentence each; empty when every cloze, marker, reference and definition lies within
 * the source, every reference's identifier is the number written in it, and every closing token closes the latest
 * opening token of its list, block tokens or an inline token's children, which also leaves none open.
 */
function parse_problems({ source, tokens, clozes, markers, references, definitions }) {
  const problems = []
  for (const record of [...clozes, ...markers, ...references, ...definitions]) {
    if (!(record.start.offset >= 0 && record.start.offset <= record.end.offset && record.end.offset <= source.length)) {
      problems.push(`${source.slice(record.start.offset, record.end.offset)} lies outside the source`)
    }
  }
  for (const reference of references) {
    if (Number(source.slice(reference.start.offset + 2, reference.end.offset - 1)) !== reference.ref) {
      problems.push(`reference ${reference.ref} differs from its source`)
    }
  }
  const balance = list => {
    const open = []
    for (const token of list) {
      if (token.nesting === 1) open.push(token)
      else if (token.nesting === -1 && open.pop()?.type.replace(/_open$/, '') !== token.type.replace(/_close$/, '')) {
        problems.push(`${token.type} closes out of order`)
      }
      if (token.type === 'inline') balance(token.children)
    }
    problems.push(...open.map(token => `${token.type} never closes`))
  }
  balance(tokens)
  return problems
}

/**
 * parse() returns the untouched source and the scheduling of each card, and records give their source positions: an
 * inline cloze starts after its opener and the spaces the opener takes, and runs to the end of its content, before
 * the reference ending its text.
 */
export function test_parse_keeps_the_source_and_record_positions() {
  const source = `
Q:: a[:7]

[:7]: n 0 0 0 0 0 0 0 0
`.slice(1)
  const parsed = parse(source)
  assert.equal(parsed.source, source)
  assert.deepEqual(parsed.scheduling, [{
    ref: 7, state: 'n', due: '0', scheduled_days: 0, last_review: '0',
    stability: 0, difficulty: 0, learning_steps: 0, reps: 0, lapses: 0
  }])
  const range = record => ({ start: record.start, end: record.end, text: source.slice(record.start.offset, record.end.offset) })
  assert.deepEqual([...parsed.clozes, ...parsed.markers, ...parsed.references, ...parsed.definitions].map(range), [
    { start: { line: 1, offset: 4 }, end: { line: 1, offset: 5 }, text: 'a' },
    { start: { line: 1, offset: 1 }, end: { line: 1, offset: 4 }, text: ':: ' },
    { start: { line: 1, offset: 5 }, end: { line: 1, offset: 9 }, text: '[:7]' },
    { start: { line: 3, offset: 11 }, end: { line: 3, offset: 34 }, text: '[:7]: n 0 0 0 0 0 0 0 0' }
  ])
}

/**
 * Records give offsets into the note's text, which parse() takes without its byte order mark and with `\n` line
 * endings: with CRLF line endings and a byte order mark, the reference stands one character earlier than in the
 * source, the definition three. A save gives the text the source's line endings and byte order mark again.
 */
export function test_records_give_offsets_into_the_text_and_saving_restores_line_endings() {
  const source = '\uFEFFQ:: answer[:1]\r\n\r\n[:1]: k 20261012040000 7 20261005120000 8.5 4.2 0 10 1\r\n'
  const parsed = parse(source)
  assert.equal(parsed.text, 'Q:: answer[:1]\n\n[:1]: k 20261012040000 7 20261005120000 8.5 4.2 0 10 1\n')
  assert.deepEqual(parsed.references.map(reference => [reference.ref, reference.start.offset, reference.end.offset, reference.key]), [
    [1, 10, 14, 't10']
  ])
  assert.deepEqual(parsed.definitions.map(definition => [definition.start.line, definition.start.offset, definition.end.offset]), [
    [3, 16, 70]
  ])
  assert.deepEqual(parsed.groups.map(group => [group.key, group.insertion, group.reference.ref, group.definition.scheduling.ref]), [
    ['t10', { kind: 'inline', offset: 10, space: false }, 1, 1]
  ])
  assert.equal(serialize(parsed, parsed.scheduling), source)
}

/**
 * A note mixing nested, explicit and table clozes, references, a reference line and definitions parses well-formed,
 * and so does what saving it writes: records within the source, references as written, tokens balanced.
 */
export function test_parses_are_well_formed() {
  const parsed = parse(`
> Q::> outer :::> inner <::[:3] tail <::[:2]

Q::

| A | B |
| - | - |
| ::: x[:4] | ::; y |

[:5]

Code::

\`\`\`
x
\`\`\`
[:6]

[:2]: l 20261010120100 0 20261010120000 2.3 5 1 2 0
[:3]: k 20261012040000 7 20261005120000 8.5 4.2 0 10 1
`.slice(1))
  assert.deepEqual(parse_problems(parsed), [])
  assert.deepEqual(parse_problems(parse(serialize(parsed, parsed.scheduling))), [])
}

/**
 * A card's first cloze and its continuations share one scheduling object, the card's in parse().scheduling, so a
 * changed record renders on every cloze without parsing again. The definition keeps what the source stores.
 */
export function test_continuations_share_their_cards_scheduling_object() {
  const source = `
Q:: first[:7]

Q:; second

[:7]: n 0 0 0 0 0 0 3 0`.slice(1)
  const parsed = parse(source)
  const clozes = parsed.clozes
  assert.equal(parsed.groups.length, 1)
  assert.equal(parsed.groups[0].first_cloze, clozes[0])
  assert.equal(parsed.groups[0].scheduling, parsed.scheduling[0])
  assert.equal(clozes[0].scheduling, parsed.scheduling[0])
  assert.equal(clozes[1].scheduling, parsed.scheduling[0])
  assert.deepEqual(parsed.references.map(reference => source.slice(reference.start.offset, reference.end.offset)), ['[:7]'])
  assert.deepEqual(parsed.definitions.map(definition => source.slice(definition.start.offset, definition.end.offset)), ['[:7]: n 0 0 0 0 0 0 3 0'])

  parsed.scheduling[0].reps = 4
  assert.equal(render(parsed), `
<p>Q: <span class="cloze" data-ordinal="1" data-card="[:7]: n 0 0 0 0 0 0 4 0">first</span></p>
<p>Q: <span class="cloze" data-ordinal="1" data-card="[:7]: n 0 0 0 0 0 0 4 0">second</span></p>`.slice(1))
  assert.equal(parsed.definitions[0].scheduling.reps, 3)
  assert.equal(parsed.source, source)
}

/** render() shows replacement scheduling when given, leaving both the parse and the replacement unchanged. */
export function test_render_shows_replacement_scheduling() {
  const parsed = parse('Q:: answer')
  const replacement = [{
    ref: -1, state: 'n', due: '0', scheduled_days: 0, last_review: '0',
    stability: 0, difficulty: 0, learning_steps: 0, reps: 42, lapses: 0
  }]
  assert.equal(render(parsed, { scheduling: replacement }),
    '<p>Q: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 42 0">answer</span></p>')
  assert.equal(card_lines(parsed), '[:-1]: n 0 0 0 0 0 0 0 0')
  assert.equal(replacement[0].ref, -1)
}

/**
 * serialize() changes neither the parse nor the scheduling it is given, so one parse can be saved again after a later
 * review. A new card keeps its in-memory identifier.
 */
export function test_serialize_changes_neither_the_parse_nor_the_scheduling_it_is_given() {
  const source = 'Q:: first\n\nQ:: second'
  const parsed = parse(source)
  const first_review = [parsed.scheduling[0], { ...parsed.scheduling[1], state: 'l', due: '20261011120100', last_review: '20261011120000', stability: 2.3, difficulty: 5, learning_steps: 1, reps: 1 }]
  assert.equal(serialize(parsed, first_review), `
Q:: first

Q:: second[:1]

[:1]: l 20261011120100 0 20261011120000 2.3 5 1 1 0
`.slice(1))
  assert.equal(parsed.source, source)
  assert.equal(card_lines(parsed), `
[:-1]: n 0 0 0 0 0 0 0 0
[:-2]: n 0 0 0 0 0 0 0 0`.slice(1))
  assert.equal(first_review[1].ref, -2)

  const second_review = [first_review[0], { ...first_review[1], reps: 2 }]
  assert.equal(serialize(parsed, second_review), `
Q:: first

Q:: second[:1]

[:1]: l 20261011120100 0 20261011120000 2.3 5 1 2 0
`.slice(1))
}

/** An empty note has no tokens, cards or metadata; rendering and saving it give empty text. */
export function test_an_empty_note() {
  const parsed = parse('')
  assert.equal(parsed.source, '')
  assert.deepEqual(parsed.tokens, [])
  assert.deepEqual(parsed.scheduling, [])
  assert.equal(render(parsed), '')
  assert.equal(serialize(parsed, parsed.scheduling), '')
}

/** A note rendered as embedded in another is not reviewed: its clozes, inline and block, have ordinal 0 and no card. */
export function test_an_embedded_note_renders_its_clozes_with_ordinal_0_and_no_card() {
  const parsed = parse(`
Q:: answer[:1]

List::

- x

[:1]: k 20261012040000 7 20261005120000 8.5 4.2 0 10 1
`.slice(1))
  assert.equal(render(parsed, { embedded: true }), `
<p>Q: <span class="cloze" data-ordinal="0">answer</span></p>
<p>List:</p>
<div class="cloze" data-ordinal="0">
<ul>
<li>x</li>
</ul>
</div>`.slice(1))
}

/** A plugin of another instance: `{{text}}` renders as `<kbd>text</kbd>`. */
const keys = md => md.inline.ruler.before('emphasis', 'keys', (state, silent) => {
  /* Take `{{` up to `}}` on the line. */
  const match = /^\{\{([^}\n]*)\}\}/.exec(state.src.slice(state.pos))
  if (!match) return false
  if (!silent) state.push('html_inline', '', 0).content = `<kbd>${md.utils.escapeHtml(match[1])}</kbd>`
  state.pos += match[0].length
  return true
})

/**
 * srmd_plugin() adds srmd to any markdown-it instance, which parses it together with its own plugins: `::` inside the
 * plugin's syntax is no marker, and an answer can be the plugin's syntax. Parsing alone gives the token stream, with
 * srmd's marker and cloze tokens, and the cards in the environment. srmd syntax applies only to a parse whose
 * environment carries `env.srmd`.
 */
export function test_the_plugin_adds_srmd_to_another_instance() {
  const md = new MarkdownIt().use(keys)
  srmd_plugin(md)
  assert.equal(md.render('{{a::b}}:: {{Ctrl}}', { srmd: {} }),
    '<p><kbd>a::b</kbd>: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0"><kbd>Ctrl</kbd></span></p>\n')
  const env = { srmd: {} }
  const tokens = md.parse('Q:: a', env)
  assert.deepEqual(tokens[1].children.map(token => token.type), ['text', 'srmd_opener', 'srmd_cloze_open', 'text', 'srmd_cloze_close'])
  assert.deepEqual(env.srmd.cards.scheduling.map(serialize_card), ['[:-1]: n 0 0 0 0 0 0 0 0'])
  assert.equal(md.render('Q:: a', {}), '<p>Q:: a</p>\n')
}

/**
 * With `positions`, srmd_plugin() gives another instance what saving needs, so its parses save as parses with srmd's
 * own instance do: among the instance's own plugins, also a block rule added once it has parsed, a review saves the
 * card's reference after its answer and its definition at the end of the note, and YAML front matter and a link
 * reference definition are blocks showing nothing.
 */
export function test_with_positions_another_instances_parses_can_be_saved() {
  const md = new MarkdownIt({ html: true }).use(keys)
  srmd_plugin(md, { positions: true })
  md.parse('First parse', {})
  md.block.ruler.before('paragraph', 'nothing', () => false)
  const parsed = parse(`
---
title: Keys
---

Copy:: {{Ctrl}} {{C}}

[docs]: https://example.com
`.slice(1), md)
  assert.equal(render(parsed),
    '<p>Copy: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0"><kbd>Ctrl</kbd> <kbd>C</kbd></span></p>')
  const reviewed = { state: 'l', due: '20261016040000', scheduled_days: 0.5, last_review: '20261015120000', stability: 2.3, difficulty: 5, learning_steps: 1, reps: 1, lapses: 0 }
  assert.equal(serialize(parsed, parsed.scheduling.map(card => ({ ...card, ...reviewed }))), `
---
title: Keys
---

Copy:: {{Ctrl}} {{C}}[:1]

[docs]: https://example.com

[:1]: l 20261016040000 0.5 20261015120000 2.3 5 1 1 0
`.slice(1))
}

// Run every test_ function above as a test named after it.
for (const [name, fn] of Object.entries(tests)) if (name.startsWith('test_')) test(name, fn)
