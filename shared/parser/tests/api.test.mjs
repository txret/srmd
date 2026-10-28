// The parser's API contracts (ARCHITECTURE.md, "Parser"): what parse() returns, how render() and serialize() use it.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parse, render, serialize, serialize_card } from '../src/index.ts'
import * as tests from './api.test.mjs'

/** Each card of a parse as its definition line, in card order; `[:-n]` marks card n without a definition. */
function card_lines(parsed) {
  return parsed.scheduling.map(serialize_card).join('\n')
}

/**
 * What is wrong with a parse's events, one sentence each; empty when every token lies within the source, every exit
 * matches the latest enter, nothing stays open, and every reference's identifier is the number written in it.
 */
function event_problems({ source, events }) {
  const problems = []
  const open = []
  for (const [kind, token] of events) {
    if (!(token.start.offset >= 0 && token.start.offset <= token.end.offset && token.end.offset <= source.length)) {
      problems.push(`${token.type} lies outside the source`)
    }
    if (kind === 'enter') open.push(token)
    else if (open.pop() !== token) problems.push(`${token.type} exits out of order`)
    if (token.type === 'cardReference' && Number(source.slice(token.start.offset + 2, token.end.offset - 1)) !== token.ref) {
      problems.push(`reference ${token.ref} differs from its source`)
    }
  }
  return [...problems, ...open.map(token => `${token.type} never exits`)]
}

/**
 * parse() returns the untouched source and the scheduling of each card; its tokens give their source positions: an
 * inline cloze starts after its opener and the spaces the opener takes.
 */
export function test_parse_keeps_the_source_and_token_positions() {
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
  const tokens = parsed.events
    .filter(([kind, token]) => kind === 'enter' && ['inlineCloze', 'cardReference', 'cardDefinition'].includes(token.type))
    .map(([, token]) => ({
      type: token.type,
      start: { line: token.start.line, column: token.start.column, offset: token.start.offset },
      end: { line: token.end.line, column: token.end.column, offset: token.end.offset },
      text: source.slice(token.start.offset, token.end.offset)
    }))
  assert.deepEqual(tokens, [
    { type: 'inlineCloze', start: { line: 1, column: 5, offset: 4 }, end: { line: 1, column: 10, offset: 9 }, text: 'a[:7]' },
    { type: 'cardReference', start: { line: 1, column: 6, offset: 5 }, end: { line: 1, column: 10, offset: 9 }, text: '[:7]' },
    { type: 'cardDefinition', start: { line: 3, column: 1, offset: 11 }, end: { line: 3, column: 24, offset: 34 }, text: '[:7]: n 0 0 0 0 0 0 0 0' }
  ])
}

/**
 * The events of a note mixing nested, explicit and table clozes, references, a reference line and definitions are
 * well-formed, and stay so after a save: tokens within the source, balanced, references as written.
 */
export function test_events_are_well_formed() {
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
  assert.deepEqual(event_problems(parsed), [])
  assert.deepEqual(event_problems(parse(serialize(parsed, parsed.scheduling))), [])
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
  const clozes = parsed.events.filter(([kind, token]) => kind === 'enter' && token.type === 'inlineCloze').map(([, token]) => token)
  assert.equal(parsed.groups.length, 1)
  assert.equal(parsed.groups[0].first_cloze, clozes[0])
  assert.equal(parsed.groups[0].scheduling, parsed.scheduling[0])
  assert.equal(clozes[0]._scheduling, parsed.scheduling[0])
  assert.equal(clozes[1]._scheduling, parsed.scheduling[0])
  assert.deepEqual(parsed.references.map(reference => source.slice(reference.start.offset, reference.end.offset)), ['[:7]'])
  assert.deepEqual(parsed.definitions.map(definition => source.slice(definition.start.offset, definition.end.offset)), ['[:7]: n 0 0 0 0 0 0 3 0'])

  parsed.scheduling[0].reps = 4
  assert.equal(render(parsed.events), `
<p>Q: <span class="cloze" data-ordinal="1" data-card="[:7]: n 0 0 0 0 0 0 4 0">first</span></p>
<p>Q: <span class="cloze" data-ordinal="1" data-card="[:7]: n 0 0 0 0 0 0 4 0">second</span></p>
`.slice(1))
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
  assert.equal(render(parsed.events, { scheduling: replacement }),
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

/** An empty note has no events, cards or metadata; rendering and saving it give empty text. */
export function test_an_empty_note() {
  const parsed = parse('')
  assert.equal(parsed.source, '')
  assert.deepEqual(parsed.events, [])
  assert.deepEqual(parsed.scheduling, [])
  assert.equal(render(parsed.events), '')
  assert.equal(serialize(parsed, parsed.scheduling), '')
}

/** A minimal optional extension: `{{text}}` renders as `<kbd>text</kbd>`. */
const keys = {
  syntax: {
    text: {
      123: {
        name: 'keys',
        tokenize(effects, ok, nok) {
          /* Consume `{{`, then anything up to `}}` on the line. */
          let opened = 0
          const start = code => {
            if (code !== 123) return nok(code)
            if (opened++ === 0) effects.enter('keys')
            effects.consume(code)
            return opened < 2 ? start : inside
          }
          const inside = code => {
            if (code === null || code < 0) return nok(code)
            effects.consume(code)
            return code === 125 ? close : inside
          }
          const close = code => {
            if (code !== 125) return inside(code)
            effects.consume(code)
            effects.exit('keys')
            return ok
          }
          return start
        }
      }
    }
  },
  html: {
    exit: {
      keys(token) {
        this.tag(`<kbd>${this.encode(this.sliceSerialize(token).slice(2, -2))}</kbd>`)
      }
    }
  }
}

/**
 * Optional extensions parse together with srmd, and the parse records them for render(): `::` inside the extension's
 * syntax is no marker, and an answer can be extension syntax. Without the extension, its syntax is text.
 */
export function test_optional_extensions_parse_with_srmd_and_render_from_the_parse() {
  const parsed = parse('{{a::b}}:: {{Ctrl}}', [keys])
  assert.deepEqual(parsed.extensions, [keys])
  assert.equal(render(parsed.events, { extensions: parsed.extensions }),
    '<p><kbd>a::b</kbd>: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0"><kbd>Ctrl</kbd></span></p>')
  assert.equal(render(parse('{{a}}:: b').events),
    '<p>{{a}}: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">b</span></p>')
}

// Run every test_ function above as a test named after it.
for (const [name, fn] of Object.entries(tests)) if (name.startsWith('test_')) test(name, fn)
