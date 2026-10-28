// Saving (SYNTAX.md, "Loading and saving"): serialize() writes references and definitions into the note's own
// Markdown, changing nothing else; persist_hints() writes resolved hints only.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parse, persist_hints, render, serialize, serialize_card } from '../src/index.ts'
import * as tests from './saving.test.mjs'

/** The scheduling a review leaves on a card, and that card's definition once saved as reference 1. */
const review = { state: 'l', due: '20261016040000', scheduled_days: 0.5, last_review: '20261015120000', stability: 2.3, difficulty: 5, learning_steps: 1, reps: 1, lapses: 0 }
const reviewed_line = '[:1]: l 20261016040000 0.5 20261015120000 2.3 5 1 1 0'

/** Each card of a parse as its definition line, in card order; `[:-n]` marks card n without a definition. */
function card_lines(parsed) {
  return parsed.scheduling.map(serialize_card).join('\n')
}

/** Save source after a review of the card with this ordinal, the first by default; the other cards keep theirs. */
function save_reviewed(source, ordinal = 1) {
  const parsed = parse(source)
  return serialize(parsed, parsed.scheduling.map((card, index) => index === ordinal - 1 ? { ...card, ...review } : card))
}

/** Reload saved Markdown: its first card as a definition line, and what saving it without changes writes. */
function reload(markdown) {
  const parsed = parse(markdown)
  return { first_card: serialize_card(parsed.scheduling[0]), saved_again: serialize(parsed, parsed.scheduling) }
}

/** Save Markdown without changing its cards. */
function save_unchanged(markdown) {
  const parsed = parse(markdown)
  return serialize(parsed, parsed.scheduling)
}

/**
 * A block cloze ending in code gets a new reference on the line after the code, which ends indented code; a
 * literal reference in the code stays.
 */
export function test_a_new_block_cloze_reference_after_code() {
  const fenced = save_reviewed('Q::\n\n```\nx\n```\n')
  assert.equal(fenced, `Q::\n\n\`\`\`\nx\n\`\`\`\n[:1]\n\n${reviewed_line}\n`)
  assert.deepEqual(reload(fenced), { first_card: reviewed_line, saved_again: fenced })

  const fenced_literal = save_reviewed('Q::\n\n```txt\nanswer[:8]\n```')
  assert.equal(fenced_literal, `Q::\n\n\`\`\`txt\nanswer[:8]\n\`\`\`\n[:1]\n\n${reviewed_line}\n`)
  assert.deepEqual(reload(fenced_literal), { first_card: reviewed_line, saved_again: fenced_literal })

  const indented_literal = save_reviewed('Q::\n\n    answer[:8]')
  assert.equal(indented_literal, `Q::\n\n    answer[:8]\n[:1]\n\n${reviewed_line}\n`)
  assert.deepEqual(reload(indented_literal), { first_card: reviewed_line, saved_again: indented_literal })
}

/** A block cloze ending in a paragraph gets a new reference at the end of its text, after emphasis ending it too. */
export function test_a_new_block_cloze_reference_after_a_paragraph() {
  const plain = save_reviewed('Q::\n\nanswer\n')
  assert.equal(plain, `Q::\n\nanswer[:1]\n\n${reviewed_line}\n`)
  assert.deepEqual(reload(plain), { first_card: reviewed_line, saved_again: plain })

  const emphasis = save_reviewed('Q::\n\n*answer*\n')
  assert.equal(emphasis, `Q::\n\n*answer*[:1]\n\n${reviewed_line}\n`)
  assert.deepEqual(reload(emphasis), { first_card: reviewed_line, saved_again: emphasis })
}

/**
 * A block cloze ending in a heading, a table or HTML gets a new reference on the next line, which ends the table;
 * after a blank line when HTML continues until one.
 */
export function test_a_new_block_cloze_reference_after_a_heading_table_or_html() {
  const heading = save_reviewed('Q::\n\n# H\n')
  assert.equal(heading, `Q::\n\n# H\n[:1]\n\n${reviewed_line}\n`)
  assert.deepEqual(reload(heading), { first_card: reviewed_line, saved_again: heading })

  const table = save_reviewed('Q::\n\n| a |\n| - |\n| b |\n')
  assert.equal(table, `Q::\n\n| a |\n| - |\n| b |\n[:1]\n\n${reviewed_line}\n`)
  assert.deepEqual(reload(table), { first_card: reviewed_line, saved_again: table })

  const html_to_blank_line = save_reviewed('Q::\n\n<div>\nx\n</div>\n')
  assert.equal(html_to_blank_line, `Q::\n\n<div>\nx\n</div>\n\n[:1]\n\n${reviewed_line}\n`)
  assert.deepEqual(reload(html_to_blank_line), { first_card: reviewed_line, saved_again: html_to_blank_line })

  const html_to_end_marker = save_reviewed('Q::\n\n<!--\nx\n-->\n')
  assert.equal(html_to_end_marker, `Q::\n\n<!--\nx\n-->\n[:1]\n\n${reviewed_line}\n`)
  assert.deepEqual(reload(html_to_end_marker), { first_card: reviewed_line, saved_again: html_to_end_marker })
}

/**
 * A block cloze ending in a list gets a new reference on the line after the whole list, which the line ends: after a
 * nested list in its last item, a loose list, and code ending its last item.
 */
export function test_a_new_block_cloze_reference_after_a_list() {
  const tight = save_reviewed('Q::\n\n- a\n- b\n')
  assert.equal(tight, `Q::\n\n- a\n- b\n[:1]\n\n${reviewed_line}\n`)
  assert.deepEqual(reload(tight), { first_card: reviewed_line, saved_again: tight })

  const nested = save_reviewed('Q::\n\n1. a\n   - b\n')
  assert.equal(nested, `Q::\n\n1. a\n   - b\n[:1]\n\n${reviewed_line}\n`)
  assert.deepEqual(reload(nested), { first_card: reviewed_line, saved_again: nested })

  const loose = save_reviewed('Q::\n\n- a\n\n- b\n')
  assert.equal(loose, `Q::\n\n- a\n\n- b\n[:1]\n\n${reviewed_line}\n`)
  assert.deepEqual(reload(loose), { first_card: reviewed_line, saved_again: loose })

  const code_last = save_reviewed('Q::\n\n- a\n\n  ```\n  x\n  ```\n')
  assert.equal(code_last, `Q::\n\n- a\n\n  \`\`\`\n  x\n  \`\`\`\n[:1]\n\n${reviewed_line}\n`)
  assert.deepEqual(reload(code_last), { first_card: reviewed_line, saved_again: code_last })
}

/**
 * Around quotes, a new reference line goes after the block in the block's own container: after a quote, on the next
 * line, which ends it; after a block in a quote, on the next quoted line.
 */
export function test_a_new_block_cloze_reference_around_quotes() {
  const quote = save_reviewed('Q::\n\n> q\n')
  assert.equal(quote, `Q::\n\n> q\n[:1]\n\n${reviewed_line}\n`)
  assert.deepEqual(reload(quote), { first_card: reviewed_line, saved_again: quote })

  const quote_of_code = save_reviewed('Q::\n\n> ```\n> x\n> ```\n')
  assert.equal(quote_of_code, `Q::\n\n> \`\`\`\n> x\n> \`\`\`\n[:1]\n\n${reviewed_line}\n`)
  assert.deepEqual(reload(quote_of_code), { first_card: reviewed_line, saved_again: quote_of_code })

  const code_in_quote = save_reviewed('> Q::\n>\n> ```\n> x\n> ```\n')
  assert.equal(code_in_quote, `> Q::\n>\n> \`\`\`\n> x\n> \`\`\`\n> [:1]\n\n${reviewed_line}\n`)
  assert.deepEqual(reload(code_in_quote), { first_card: reviewed_line, saved_again: code_in_quote })

  const list_in_quote = save_reviewed('> Q::\n>\n> - a\n')
  assert.equal(list_in_quote, `> Q::\n>\n> - a\n> [:1]\n\n${reviewed_line}\n`)
  assert.deepEqual(reload(list_in_quote), { first_card: reviewed_line, saved_again: list_in_quote })

  const table_in_quote = save_reviewed('> Q::\n>\n> | a |\n> | - |\n')
  assert.equal(table_in_quote, `> Q::\n>\n> | a |\n> | - |\n> [:1]\n\n${reviewed_line}\n`)
  assert.deepEqual(reload(table_in_quote), { first_card: reviewed_line, saved_again: table_in_quote })
}

/** An explicit cloze gets a new reference right after its closer, block or inline, before any spaces after it. */
export function test_a_new_explicit_cloze_reference_follows_its_closer() {
  const block = save_reviewed('Q ::>\n\nanswer\n\n<::\n')
  assert.equal(block, `Q ::>\n\nanswer\n\n<::[:1]\n\n${reviewed_line}\n`)
  assert.deepEqual(reload(block), { first_card: reviewed_line, saved_again: block })

  const inline = save_reviewed('Q ::>a<:: more\n')
  assert.equal(inline, `Q ::>a<::[:1] more\n\n${reviewed_line}\n`)
  assert.deepEqual(reload(inline), { first_card: reviewed_line, saved_again: inline })

  const spaces_after = save_reviewed('Q::> answer <::\x20\x20\nnext')
  assert.equal(spaces_after, `Q::> answer <::[:1]\x20\x20\nnext\n\n${reviewed_line}\n`)
  assert.deepEqual(reload(spaces_after), { first_card: reviewed_line, saved_again: spaces_after })

  // The closer's `<` ends the URL before it.
  const url = save_reviewed('Q ::>https://example.com/a<::\n')
  assert.equal(url, `Q ::>https://example.com/a<::[:1]\n\n${reviewed_line}\n`)
  assert.deepEqual(reload(url), { first_card: reviewed_line, saved_again: url })
}

/**
 * An implicit inline cloze gets a new reference at the end of its content: before the spaces or backslash of the
 * hard break ending it, and inside the emphasis ending it.
 */
export function test_a_new_implicit_inline_cloze_reference_ends_its_content() {
  const spaces = save_reviewed('Q:: a\x20\x20\nnext\n')
  assert.equal(spaces, `Q:: a[:1]\x20\x20\nnext\n\n${reviewed_line}\n`)
  assert.deepEqual(reload(spaces), { first_card: reviewed_line, saved_again: spaces })

  const backslash = save_reviewed('Q:: answer\\\nnext')
  assert.equal(backslash, `Q:: answer[:1]\\\nnext\n\n${reviewed_line}\n`)
  assert.deepEqual(reload(backslash), { first_card: reviewed_line, saved_again: backslash })

  const emphasis = save_reviewed('**Q:: answer** more\n')
  assert.equal(emphasis, `**Q:: answer[:1]** more\n\n${reviewed_line}\n`)
  assert.deepEqual(reload(emphasis), { first_card: reviewed_line, saved_again: emphasis })
}

/**
 * A new inline reference goes after a space where the text before it would otherwise take it in: `!` (an image),
 * an escaping backslash, an implicit opener, and a literal URL, also with only punctuation after it. An email address
 * ends at its domain and needs none.
 */
export function test_a_new_inline_reference_follows_a_space_where_the_text_would_take_it_in() {
  const exclamation = save_reviewed('Q:: Hello!\n')
  assert.equal(exclamation, `Q:: Hello! [:1]\n\n${reviewed_line}\n`)
  assert.deepEqual(reload(exclamation), { first_card: reviewed_line, saved_again: exclamation })

  const backslash = save_reviewed('Q:: answer\\')
  assert.equal(backslash, `Q:: answer\\ [:1]\n\n${reviewed_line}\n`)
  assert.deepEqual(reload(backslash), { first_card: reviewed_line, saved_again: backslash })

  const opener = save_reviewed('Q ::>a :::\n\nb\n')
  assert.equal(opener, `Q ::>a ::: [:1]\n\nb\n\n${reviewed_line}\n`)
  assert.deepEqual(reload(opener), { first_card: reviewed_line, saved_again: opener })

  const url = save_reviewed('Q:: https://example.com/heart\n')
  assert.equal(url, `Q:: https://example.com/heart [:1]\n\n${reviewed_line}\n`)
  assert.deepEqual(reload(url), { first_card: reviewed_line, saved_again: url })

  const url_and_period = save_reviewed('Q:: see www.example.com/a.\n')
  assert.equal(url_and_period, `Q:: see www.example.com/a. [:1]\n\n${reviewed_line}\n`)
  assert.deepEqual(reload(url_and_period), { first_card: reviewed_line, saved_again: url_and_period })

  const url_in_block = save_reviewed('Q::\n\nread https://example.com/a\n')
  assert.equal(url_in_block, `Q::\n\nread https://example.com/a [:1]\n\n${reviewed_line}\n`)
  assert.deepEqual(reload(url_in_block), { first_card: reviewed_line, saved_again: url_in_block })

  const email = save_reviewed('Q:: a@example.com\n')
  assert.equal(email, `Q:: a@example.com[:1]\n\n${reviewed_line}\n`)
  assert.deepEqual(reload(email), { first_card: reviewed_line, saved_again: email })
}

/**
 * A card's reference is saved at its first cloze, never a continuation, also when the continuation has a lower
 * ordinal or holds a reference: that one is removed. The continuation keeps sharing the card.
 */
export function test_a_card_reference_is_saved_at_its_first_cloze() {
  // The inner first cloze shares its ending with an outer continuation of card 1.
  const lower_continuation = save_reviewed('Q:: first\n\nQ:; outer ::: inner', 2)
  assert.equal(lower_continuation, `
Q:: first

Q:; outer ::: inner[:1]

${reviewed_line}
`.slice(1))
  assert.equal(card_lines(parse(lower_continuation)), `
[:-1]: n 0 0 0 0 0 0 0 0
${reviewed_line}`.slice(1))

  const continuation_reference = save_reviewed(`
Q:: first

Q:; second[:8]

[:8]: k 20261012040000 7 20261005120000 8.5 4.2 0 10 1
`.slice(1))
  assert.equal(continuation_reference, `
Q:: first[:1]

Q:; second

${reviewed_line}
`.slice(1))
  assert.deepEqual(reload(continuation_reference), { first_card: reviewed_line, saved_again: continuation_reference })

  // The reference goes before the hard break ending the first cloze; the continuation shows the same card.
  const shared = save_reviewed(`
:: first\x20\x20
last

:; continuation`.slice(1))
  assert.equal(shared, `
:: first[:1]\x20\x20
last

:; continuation

${reviewed_line}
`.slice(1))
  assert.equal(render(parse(shared).events), `
<p>: <span class="cloze" data-ordinal="1" data-card="${reviewed_line}">first</span><br />
last</p>
<p>: <span class="cloze" data-ordinal="1" data-card="${reviewed_line}">continuation</span></p>
`.slice(1))
}

/**
 * Only cards with scheduling data, anything but state `n` with every other field zero, get new references and
 * definitions: new cards stay as written, and a review saves the reviewed card alone. A card in state `n` with
 * review history has data.
 */
export function test_only_cards_with_scheduling_data_get_new_references_and_definitions() {
  assert.equal(save_unchanged('Q:: outer ::: inner'), 'Q:: outer ::: inner')
  assert.equal(save_unchanged('::\n\n- first\n- second'), '::\n\n- first\n- second')

  assert.equal(save_reviewed('Q:: first\n\nQ:: second', 2), `
Q:: first

Q:: second[:1]

${reviewed_line}
`.slice(1))

  const parsed = parse('Q:: answer')
  const history = { ...parsed.scheduling[0], reps: 42 }
  assert.equal(serialize(parsed, [history]), `
Q:: answer[:1]

[:1]: n 0 0 0 0 0 0 42 0
`.slice(1))
}

/**
 * A card without scheduling data keeps the reference and definition written for it, renumbered: an all-zero card,
 * a card reset to new, and a new card with stored data. A reviewed card's definition joins the last definition
 * block.
 */
export function test_cards_keep_the_references_and_definitions_written_for_them() {
  const parsed = parse(`
[:9]: k 0 0 0 0 0 0 3 0

A:: first[:9]

B:: second

C:: third[:7]


[:7]: n 0 0 0 0 0 0 0 0

 \t`.slice(1))
  // A is reset to state n, B is reviewed, C stays all zero.
  const scheduling = [{ ...parsed.scheduling[0], state: 'n' }, { ...parsed.scheduling[1], ...review }, parsed.scheduling[2]]
  const saved = serialize(parsed, scheduling)
  assert.equal(saved, `
[:1]: n 0 0 0 0 0 0 3 0

A:: first[:1]

B:: second[:2]

C:: third[:3]


[:2]: l 20261016040000 0.5 20261015120000 2.3 5 1 1 0
[:3]: n 0 0 0 0 0 0 0 0

 \t`.slice(1))
  assert.equal(save_unchanged(saved), saved)

  const new_with_data = `
Q:: answer[:8]

--------------------

[:8]: n 20261012040000 7 20261005120000 8.5 4.2 0 10 1`.slice(1)
  assert.equal(save_unchanged(new_with_data), `
Q:: answer[:1]

--------------------

[:1]: n 20261012040000 7 20261005120000 8.5 4.2 0 10 1`.slice(1))
}

/**
 * Where first clozes share an ending, a card with data there gives every card there a reference, so ownership stays
 * unambiguous on reload; definitions only for those with data. A card elsewhere without data gets nothing.
 */
export function test_cards_sharing_an_ending_with_a_reviewed_card_get_references() {
  const inner_reviewed = save_reviewed('Q:: outer ::: inner', 2)
  assert.equal(inner_reviewed, `
Q:: outer ::: inner[:2][:1]

[:2]: l 20261016040000 0.5 20261015120000 2.3 5 1 1 0
`.slice(1))
  // The outer card owns a reference without a definition, and keeps its in-memory identifier.
  assert.equal(card_lines(parse(inner_reviewed)), `
[:-1]: n 0 0 0 0 0 0 0 0
[:2]: l 20261016040000 0.5 20261015120000 2.3 5 1 1 0`.slice(1))
  assert.equal(save_unchanged(inner_reviewed), inner_reviewed)

  const outer_reviewed = save_reviewed('Q:: outer ::: inner', 1)
  assert.equal(outer_reviewed, `
Q:: outer ::: inner[:2][:1]

${reviewed_line}
`.slice(1))
  assert.equal(card_lines(parse(outer_reviewed)), `
${reviewed_line}
[:-2]: n 0 0 0 0 0 0 0 0`.slice(1))
  assert.equal(save_unchanged(outer_reviewed), outer_reviewed)

  // A keeps the reference and definition written for it; C, elsewhere, gets nothing.
  assert.equal(save_reviewed(`
A:: a[:5]

C:: c

B:: outer ::: inner

[:5]: n
`.slice(1), 4), `
A:: a[:1]

C:: c

B:: outer ::: inner[:3][:2]

[:1]: n 0 0 0 0 0 0 0 0
[:3]: l 20261016040000 0.5 20261015120000 2.3 5 1 1 0
`.slice(1))
}

/**
 * References are numbered from 1 in card order, whatever they were and however many new cards come between; each
 * definition keeps every field of its card.
 */
export function test_references_are_numbered_from_1_in_card_order() {
  const interleaved = parse(`
Fresh:: one

Known:: two[:7]

Fresh:: three

Other:: four[:9]

[:7]: k 20261012040000 7 20261005120000 8.5 4.2 0 10 1
[:9]: l 0 0 0 0 0 0 2 0
`.slice(1))
  const saved = serialize(interleaved, interleaved.scheduling)
  assert.equal(saved, `
Fresh:: one

Known:: two[:1]

Fresh:: three

Other:: four[:2]

[:1]: k 20261012040000 7 20261005120000 8.5 4.2 0 10 1
[:2]: l 0 0 0 0 0 0 2 0
`.slice(1))
  assert.equal(card_lines(parse(saved)), `
[:-1]: n 0 0 0 0 0 0 0 0
[:1]: k 20261012040000 7 20261005120000 8.5 4.2 0 10 1
[:-3]: n 0 0 0 0 0 0 0 0
[:2]: l 0 0 0 0 0 0 2 0`.slice(1))

  // The clozes were reordered and edited since the last save.
  assert.equal(save_unchanged(`
B:: edited[:7]

A:: changed[:4]

[:4]: k 20261012040000 7 20261005120000 8.5 4.2 0 10 1
[:7]: r 20261015040000 10 20261005130000 12.5 5.1 2 20 3
`.slice(1)), `
B:: edited[:1]

A:: changed[:2]

[:1]: r 20261015040000 10 20261005130000 12.5 5.1 2 20 3
[:2]: k 20261012040000 7 20261005120000 8.5 4.2 0 10 1
`.slice(1))
}

/**
 * References and definitions are updated where they stand: a blank line before a reference line stays, and a
 * definition outside the last definition block keeps its place. New definitions join the last block of root-level
 * definitions, wherever it is, which is written sorted.
 */
export function test_existing_references_and_definitions_are_updated_in_place() {
  assert.equal(save_reviewed(`
Code::

\`\`\`
x
\`\`\`

[:7]

A:: a[:5]

[:5]: k 20261014040000 7 20261007120000 8.5 4.2 0 10 1

B:: b

[:7]: r 20261014040000 7 20261007120000 8.5 4.2 1 10 2

More notes.
`.slice(1), 3), `
Code::

\`\`\`
x
\`\`\`

[:1]

A:: a[:2]

[:2]: k 20261014040000 7 20261007120000 8.5 4.2 0 10 1

B:: b[:3]

[:1]: r 20261014040000 7 20261007120000 8.5 4.2 1 10 2
[:3]: l 20261016040000 0.5 20261015120000 2.3 5 1 1 0

More notes.
`.slice(1))
}

/**
 * Definitions before the last root-level block keep their order and place; that block is sorted, keeping the
 * whitespace after it. Definitions in a list or quote stay where they are, a partial one written in full with its
 * trailing whitespace, and a repeat of a matched identifier goes without moving the matched one.
 */
export function test_only_the_last_root_level_definition_block_is_sorted() {
  const sorted = save_unchanged(`
[:30]: k 0 0 0 0 0 0 3 0
[:20]: r 0 0 0 0 0 0 2 1

A:: a[:10]

B:: b[:20]

C:: c[:30]

D:: d[:40]


---


[:40]: k 0 0 0 0 0 0 3 0
[:10]: k 0 0 0 0 0 0 3 0\t\x20
\x20
\t`.slice(1))
  assert.equal(sorted, `
[:3]: k 0 0 0 0 0 0 3 0
[:2]: r 0 0 0 0 0 0 2 1

A:: a[:1]

B:: b[:2]

C:: c[:3]

D:: d[:4]


---


[:1]: k 0 0 0 0 0 0 3 0
[:4]: k 0 0 0 0 0 0 3 0\t\x20
\x20
\t`.slice(1))
  assert.equal(save_unchanged(sorted), sorted)

  assert.equal(save_unchanged(`
Q:: answer[:9]

- [:9]: l 0 0 0 0 0 0 1 0
`.slice(1)), `
Q:: answer[:1]

- [:1]: l 0 0 0 0 0 0 1 0
`.slice(1))

  assert.equal(save_unchanged(`
> [:9]: l 0 0\t\x20
>
> Q:: answer[:9]`.slice(1)), `
> [:1]: l 0 0 0 0 0 0 0 0\t\x20
>
> Q:: answer[:1]`.slice(1))

  assert.equal(save_unchanged(`
Q:: answer[:9]

[:9]: l 0 0 0 0 0 0 1 0

Middle

[:9]: k 0 0 0 0 0 0 5 0


End`.slice(1)), `
Q:: answer[:1]

[:1]: l 0 0 0 0 0 0 1 0

Middle


End`.slice(1))
}

/**
 * Misplaced and surplus references are removed without stray whitespace: between words a space goes with one, a
 * reference alone on a paragraph line takes its line, and a reference line goes whole. Spaces before a removed
 * reference at a line end go too, so no hard break appears, also with CRLF.
 */
export function test_misplaced_and_surplus_references_are_removed_without_stray_whitespace() {
  const parsed = parse(`
Q:: answer[:1][:2]

Text [:3] more
[:4]

[:5]

End.
`.slice(1))
  assert.equal(serialize(parsed, [{ ...parsed.scheduling[0], ...review }]), `
Q:: answer[:1]

Text more

End.

${reviewed_line}
`.slice(1))

  const crlf = save_unchanged(`
Q:: answer  [:8]\r
next\r
\r
[:8]: n 0 0 0 0 0 0 0 0\r
`.slice(1))
  assert.equal(crlf, `
Q:: answer\r
next\r
`.slice(1))
}

/**
 * An orphan definition at root level goes with its line and the blank line above it, keeping the other blank lines
 * and whitespace byte for byte; a note of only an orphan definition becomes empty.
 */
export function test_an_orphan_definition_at_root_level_goes_with_one_blank_line() {
  assert.equal(save_unchanged(`
Before


[:9]: n 0 0 0 0 0 0 0 0
After`.slice(1)), `
Before


After`.slice(1))

  assert.equal(save_unchanged(`
Before


[:9]: n 0 0 0 0 0 0 0 0



After`.slice(1)), `
Before




After`.slice(1))

  assert.equal(save_unchanged(`
Before



[:9]: n 0 0 0 0 0 0 0 0


After`.slice(1)), `
Before




After`.slice(1))

  assert.equal(save_unchanged(`
[:9]: n 0 0 0 0 0 0 0 0
\x20
\t
After`.slice(1)), `
\x20
\t
After`.slice(1))

  assert.equal(save_unchanged(`
Before

[:9]: n 0 0 0 0 0 0 0 0


[:8]: n 0 0 0 0 0 0 0 0

After`.slice(1)), `
Before

After`.slice(1))

  assert.equal(save_unchanged(`
Body


[:9]: n 0 0 0 0 0 0 0 0\t
\x20
\t`.slice(1)), `
Body

\x20
\t`.slice(1))

  assert.equal(save_unchanged('[:8]: n 0 0 0 0 0 0 0 0\n'), '')
}

/** An orphan definition in a list item goes the same way, keeping list markers and indentation and other items' lines. */
export function test_an_orphan_definition_in_a_list_keeps_the_list_markers() {
  assert.equal(save_unchanged(`
- Before


  [:9]: n 0 0 0 0 0 0 0 0



  After
- Next`.slice(1)), `
- Before




  After
- Next`.slice(1))

  assert.equal(save_unchanged(`
- [:9]: n 0 0 0 0 0 0 0 0
- Next`.slice(1)), `
-
- Next`.slice(1))

  assert.equal(save_unchanged(`
- [:9]: n 0 0 0 0 0 0 0 0

  After
- Next`.slice(1)), `
-

  After
- Next`.slice(1))

  // The blank lines ending the previous item are that item's.
  assert.equal(save_unchanged(`
- Before


- [:9]: n 0 0 0 0 0 0 0 0

  After`.slice(1)), `
- Before


-

  After`.slice(1))

  assert.equal(save_unchanged(`
- Outer

  1. [:9]: n 0 0 0 0 0 0 0 0

     After
  2. Next`.slice(1)), `
- Outer

  1.

     After
  2. Next`.slice(1))
}

/** An orphan definition in a quote goes the same way, keeping the quote prefixes of the lines that stay, also with CRLF. */
export function test_an_orphan_definition_in_a_quote_keeps_the_quote_prefixes() {
  assert.equal(save_unchanged(`
> Before
>
> [:9]: n 0 0 0 0 0 0 0 0
>\x20
>\t
> After`.slice(1)), `
> Before
>\x20
>\t
> After`.slice(1))

  assert.equal(save_unchanged(`
> - [:9]: k 0 0 0 0 0 0 1 0
> - Next`.slice(1)), `
> -
> - Next`.slice(1))

  assert.equal(save_unchanged(`
> Before\r
>\r
>\r
> [:9]: n 0 0 0 0 0 0 0 0\r
>\r
> After\r
`.slice(1)), `
> Before\r
>\r
>\r
> After\r
`.slice(1))
}

/**
 * Definitions next to thematic breaks stay where they are, and the breaks stay too: saving adds no separator or final
 * newline, and earlier definitions update in place after their breaks.
 */
export function test_definitions_after_thematic_breaks_stay_with_the_breaks() {
  assert.equal(save_unchanged(`
Q:: answer[:8]

[:8]: k 0 0 0 0 0 0 1 0`.slice(1)), `
Q:: answer[:1]

[:1]: k 0 0 0 0 0 0 1 0`.slice(1))

  assert.equal(save_unchanged(`
Q:: answer[:8]

* * *

[:8]: k 0 0 0 0 0 0 1 0`.slice(1)), `
Q:: answer[:1]

* * *

[:1]: k 0 0 0 0 0 0 1 0`.slice(1))

  assert.equal(save_unchanged(`
***

Q:: answer[:8]

___

[:8]: k 0 0 0 0 0 0 1 0`.slice(1)), `
***

Q:: answer[:1]

___

[:1]: k 0 0 0 0 0 0 1 0`.slice(1))

  assert.equal(save_unchanged(`
Q:: first[:8]

---
[:8]: k 0 0 0 0 0 0 1 0

Q:: second[:3]

***
[:3]: l 0 0 0 0 0 0 2 0`.slice(1)), `
Q:: first[:1]

---
[:1]: k 0 0 0 0 0 0 1 0

Q:: second[:2]

***
[:2]: l 0 0 0 0 0 0 2 0`.slice(1))
}

/**
 * An orphan definition after a thematic break or setext underline goes, and the break or heading stays, also when
 * the break is a block cloze's answer; a break before a paragraph is no metadata at all.
 */
export function test_orphan_definitions_after_thematic_breaks_go_and_the_breaks_stay() {
  assert.equal(save_unchanged(`
Body

--------------------

[:8]: k 0 0 0 0 0 0 1 0`.slice(1)), `
Body

--------------------
`.slice(1))

  assert.equal(save_unchanged(`
Q::

--------------------

[:8]: k 0 0 0 0 0 0 1 0`.slice(1)), `
Q::

--------------------
`.slice(1))

  assert.equal(save_unchanged(`
Title
---

[:8]: k 0 0 0 0 0 0 1 0`.slice(1)), `
Title
---
`.slice(1))

  assert.equal(save_unchanged(`
Before

---

Q:: fresh`.slice(1)), `
Before

---

Q:: fresh`.slice(1))
}

/**
 * The first saved definition starts a block at the end of the note, after the note's own trailing whitespace and line
 * endings, adding only what makes a blank line before it, and keeps CRLF line endings.
 */
export function test_a_new_definition_block_reuses_the_trailing_whitespace() {
  const no_final_newline = save_reviewed('Q:: answer')
  assert.equal(no_final_newline, `Q:: answer[:1]\n\n${reviewed_line}\n`)
  assert.deepEqual(reload(no_final_newline), { first_card: reviewed_line, saved_again: no_final_newline })

  const one_final_newline = save_reviewed('Q:: answer\n')
  assert.equal(one_final_newline, `Q:: answer[:1]\n\n${reviewed_line}\n`)

  const three_final_newlines = save_reviewed('Q:: answer\n\n\n')
  assert.equal(three_final_newlines, `Q:: answer[:1]\n\n\n${reviewed_line}\n`)
  assert.deepEqual(reload(three_final_newlines), { first_card: reviewed_line, saved_again: three_final_newlines })

  const crlf_space_tab = save_reviewed('Q:: answer\r\n\x20\r\n\t')
  assert.equal(crlf_space_tab, `Q:: answer[:1]\r\n\x20\r\n\t\r\n${reviewed_line}\r\n`)
  assert.deepEqual(reload(crlf_space_tab), { first_card: reviewed_line, saved_again: crlf_space_tab })

  assert.equal(save_reviewed('Q:: fresh\r\n\r\nQ:: reviewed\r\n', 2), `
Q:: fresh\r
\r
Q:: reviewed[:1]\r
\r
${reviewed_line}\r
`.slice(1))
}

/**
 * Definitions saved after unfinished code or HTML are inside it: saving does not repair the Markdown, so on reload
 * they are literal content and the card is new again.
 */
export function test_definitions_saved_into_unfinished_code_or_html_are_literal() {
  const fence = save_reviewed('Q:: answer\n\n```txt\nliteral')
  assert.equal(fence, `Q:: answer[:1]\n\n\`\`\`txt\nliteral\n\n${reviewed_line}\n`)
  assert.deepEqual(parse(fence).definitions, [])
  assert.equal(card_lines(parse(fence)), '[:-1]: n 0 0 0 0 0 0 0 0')

  const html = save_reviewed('Q:: answer\n\n<script>\nliteral')
  assert.equal(html, `Q:: answer[:1]\n\n<script>\nliteral\n\n${reviewed_line}\n`)
  assert.deepEqual(parse(html).definitions, [])
  assert.equal(card_lines(parse(html)), '[:-1]: n 0 0 0 0 0 0 0 0')
}

/**
 * parse() lists the hint definitions, and persist_hints() replaces only their state and due fields, adding a due
 * field after the state when there is none. Misplaced references, an orphan definition, numbering, order, spacing
 * and the other fields stay as written.
 */
export function test_persist_hints_writes_only_the_resolved_state_and_due_fields() {
  const parsed = parse(`
A:: a[:4]

B:: b[:2]

C:: c[:3]

Stray [:9] text.

[:9]: k 20261014040000 7
[:2]: 7d
[:4]: k 20261014040000 7
[:3]:\t2w  0 5
`.slice(1))
  // Each hint as [card ordinal, definition identifier].
  assert.deepEqual(parsed.hints.map(hint => [hint.ordinal, hint.definition.scheduling.ref]), [[2, 2], [3, 3]])
  const resolved = [
    parsed.scheduling[0],
    { ...parsed.scheduling[1], state: 'k', due: '20261022040000' },
    { ...parsed.scheduling[2], state: 'k', due: '20261029040000' }
  ]
  assert.equal(persist_hints(parsed.source, parsed.hints, resolved), `
A:: a[:4]

B:: b[:2]

C:: c[:3]

Stray [:9] text.

[:9]: k 20261014040000 7
[:2]: k 20261022040000
[:4]: k 20261014040000 7
[:3]:\tk  20261029040000 5
`.slice(1))
}

// Run every test_ function above as a test named after it.
for (const [name, fn] of Object.entries(tests)) if (name.startsWith('test_')) test(name, fn)
