/**
 * Save scheduling by editing the original Markdown at positions identified by parse() (SYNTAX.md, "Loading and
 * saving"). References and definitions are rewritten, inserted or removed where they are, and everything between
 * those edits is copied verbatim. Only the last block of root-level definitions is sorted.
 */
import type { Token } from 'micromark-util-types'
import { cards_by_key, has_scheduling, serialize_card } from './cards'
import type { CardDefinition, CardReference, Hint, ParsedNote, Scheduling } from './types'

/** Replace source.slice(start, end) with text: equal bounds insert, empty text deletes. Offsets index the original source. */
interface SourceEdit {
  start: number
  end: number
  text: string
}

/**
 * Save current scheduling, keeping references and definitions where they stand.
 * @param parsed - Result of parse(): its source, cards with their positions, references and definitions.
 * @param scheduling - Current cards in ordinal order.
 * @returns Markdown with references numbered from 1 in card order and the last definition block sorted.
 * @remarks Inputs are unchanged. Hosts call this when a review changes scheduling; resolved hints alone are saved
 * with persist_hints(), which normalizes nothing.
 */
export function serialize(parsed: ParsedNote, scheduling: readonly Scheduling[]): string {
  /*
   * 1. Select the positions where a card with scheduling data belongs, with every card there: first clozes sharing
   *    an ending all get references. Elsewhere select only the cards owning a reference, which the author wrote
   *    for them. Number the selected cards from 1 in card order.
   * 2. At each selected position, write its cards' references innermost first over the first reference standing
   *    there, or at the position's insertion. Remove every other reference.
   * 3. Rewrite the definitions of selected cards with data or a definition in place, except those in the last block
   *    of root-level definitions: that block is rewritten sorted, with definitions added for cards with data that
   *    have none. Remove all other definitions. Without root-level definitions, a new block goes at the end.
   */
  const { source, groups, references, definitions } = parsed
  const newline = source.includes('\r\n') ? '\r\n' : source.includes('\r') ? '\r' : '\n'
  const edits: SourceEdit[] = []

  // Step 1: selection and numbering.
  const positions = [...cards_by_key(groups)]
    .map(([key, cards]) => [key, cards.some(card => has_scheduling(scheduling[card.ordinal - 1])) ? cards : cards.filter(card => card.reference)] as const)
    .filter(([, cards]) => cards.length)
  const selected = positions.flatMap(([, cards]) => cards).sort((left, right) => left.ordinal - right.ordinal)
  const ref_of = new Map(selected.map((card, index) => [card, index + 1]))

  // Step 2: references.
  /** The references rewritten at the selected positions, and the lines they keep. */
  const kept = new Set<CardReference>()
  const kept_lines = new Set<number>()
  for (const [, cards] of positions) {
    const run = cards.map(card => `[:${ref_of.get(card)}]`).join('')
    // Parsing gave a position's references to its cards innermost first, so its first card owns the first one.
    const existing = cards[0].reference
    if (existing) {
      kept.add(existing)
      kept_lines.add(line_start(source, existing.start.offset))
      edits.push({ start: existing.start.offset, end: existing.end.offset, text: run })
      continue
    }
    const insertion = cards[cards.length - 1].insertion!
    const before = insertion.kind === 'line'
      ? newline + (insertion.blank ? insertion.prefix.trimEnd() + newline : '') + insertion.prefix
      : insertion.space ? ' ' : ''
    edits.push({ start: insertion.offset, end: insertion.offset, text: before + run })
  }
  for (const reference of references) {
    if (!kept.has(reference)) edits.push(removal(source, reference, kept_lines))
  }

  // Step 3: definitions.
  const block = card_block(source, definitions)
  /**
   * The card block's definitions. Selected cards are numbered in the order they are walked here, so the lines are
   * sorted by reference as they are collected.
   */
  const block_lines: string[] = []
  const retained = new Set<CardDefinition>()
  for (const card of selected) {
    const record = scheduling[card.ordinal - 1]
    if (!has_scheduling(record) && !card.definition) continue
    const text = serialize_card({ ...record, ref: ref_of.get(card)! })
    if (card.definition && !block.includes(card.definition)) {
      retained.add(card.definition)
      edits.push({ start: card.definition.start.offset, end: definition_end(source, card.definition), text })
    } else block_lines.push(text)
  }
  for (const definition of definitions) {
    if (!retained.has(definition) && !block.includes(definition)) edits.push(removal(source, definition, kept_lines))
  }
  const block_text = block_lines.join(newline)
  if (block.length) {
    const start = block[0].start.offset
    const end = definition_end(source, block[block.length - 1])
    edits.push(block_text ? { start, end, text: block_text } : line_removal(source, start, end))
  }
  const body = apply_source_edits(source, edits)
  if (block.length || !block_text) return body

  // Without root-level definitions, a new block goes at the end. Reuse the author's trailing blank lines; ensure
  // a blank line and column zero, so ordinary paragraphs and lists cannot swallow it.
  const trailing = /[ \t\r\n]*$/.exec(body)![0]
  const endings = trailing.match(/\r\n|\r|\n/g)?.length ?? 0
  const separation = newline.repeat(Math.max(2 - endings, /[ \t]$/.test(body) ? 1 : 0))
  return body + separation + block_text + newline
}

/**
 * Save resolved manual hints and nothing else (SYNTAX.md: manual scheduling is persisted without any other
 * normalization): in each hint's definition, the state and due fields become the resolved card's.
 * @param source - The parsed note's source.
 * @param hints - The hints from parse().
 * @param scheduling - The scheduler's cards in ordinal order, with the hints resolved.
 * @returns Markdown in which only those fields changed.
 */
export function persist_hints(source: string, hints: readonly Hint[], scheduling: readonly Scheduling[]): string {
  return apply_source_edits(source, hints.map(({ ordinal, definition }) => {
    const card = scheduling[ordinal - 1]
    // The label, the state field, and the due field if the definition has one.
    const fields = /^(\[:\d+\]:[ \t]*)\S+(?:([ \t]+)\S+)?/.exec(source.slice(definition.start.offset, definition.end.offset))!
    const text = `${fields[1]}${card.state}${fields[2] ?? ' '}${card.due}`
    return { start: definition.start.offset, end: definition.start.offset + fields[0].length, text }
  }))
}

/** The last run of root-level definitions, separated only by whitespace: new definitions go there, sorted. */
function card_block(source: string, definitions: CardDefinition[]): CardDefinition[] {
  const root = definitions.filter(definition => definition.root)
  const block = root.slice(-1)
  for (let i = root.length - 2; i >= 0 && !source.slice(root[i].end.offset, block[0].start.offset).trim(); i--) {
    block.unshift(root[i])
  }
  return block
}

/** A definition's end before trailing spaces and tabs, which belong to the author's layout. */
function definition_end(source: string, definition: CardDefinition): number {
  let end = definition.end.offset
  while (source[end - 1] === ' ' || source[end - 1] === '\t') end--
  return end
}

/** The offset where the line holding offset starts. */
function line_start(source: string, offset: number): number {
  while (offset > 0 && source[offset - 1] !== '\n' && source[offset - 1] !== '\r') offset--
  return offset
}

/**
 * Remove a reference or definition: with its line when nothing else is on it but whitespace, quote markers and
 * other removed references, so no blank line is left in a paragraph or between blocks; otherwise alone, with the
 * space before it when whitespace or the line end follows, so `a [:9] b` becomes `a b`.
 * @param kept_lines - Starts of the lines holding references that stay.
 */
function removal(source: string, token: Token, kept_lines: Set<number>): SourceEdit {
  /* Look at the rest of the token's line; a definition spans its line up to trailing whitespace. */
  const start = line_start(source, token.start.offset)
  const end = /[^\r\n]*/.exec(source.slice(token.end.offset))![0].length + token.end.offset
  const rest = (source.slice(start, token.start.offset) + source.slice(token.end.offset, end)).replace(/\[:\d+\]/g, '')
  if (!/[^ \t>]/.test(rest) && !kept_lines.has(start)) return line_removal(source, token.start.offset, token.end.offset)
  // Before a line end every space goes, so none trails; before a space, one goes.
  const is_space = (character: string | undefined): boolean => character === ' ' || character === '\t'
  let from = token.start.offset
  const next = source[token.end.offset]
  if (next === undefined || next === '\r' || next === '\n') {
    while (is_space(source[from - 1])) from--
  } else if (is_space(next) && is_space(source[from - 1])) from--
  return { start: from, end: token.end.offset, text: '' }
}

/**
 * Remove the lines holding start to end, with their line ending. When the line above is blank (whitespace and
 * quote markers only) and so is the line below or the end of the note, the blank line above goes too, so the
 * blocks around keep a single blank line between them.
 */
function line_removal(source: string, start: number, end: number): SourceEdit {
  /* Widen the range to whole lines, then to the blank line above when the removal would leave two. */
  let from = line_start(source, start)
  const to = end + /^[^\r\n]*(?:\r\n|\r|\n)?/.exec(source.slice(end))![0].length
  const blank = (line: string): boolean => !/[^ \t>\r\n]/.test(line)
  // The line above ends before the line ending in front of from.
  const ending = from - (source.slice(from - 2, from) === '\r\n' ? 2 : 1)
  const above = from > 0 ? line_start(source, ending) : -1
  const below = /^[^\r\n]*/.exec(source.slice(to))![0]
  if (above >= 0 && blank(source.slice(above, from)) && (to === source.length || blank(below))) from = above
  return { start: from, end: to, text: '' }
}

/**
 * Apply edits to the original source; an edit overlapping an earlier one is dropped.
 * @param edits - Edits with offsets into source; insertions sort before removals starting at the same offset.
 * @returns Unchanged source gaps interleaved with replacement text.
 */
function apply_source_edits(source: string, edits: SourceEdit[]): string {
  /* Sort once, then copy forwards; cursor is the first source character not yet copied or removed. */
  edits.sort((left, right) => left.start - right.start || (left.end - left.start) - (right.end - right.start))
  const parts: string[] = []
  let cursor = 0
  for (const edit of edits) {
    if (edit.start < cursor) continue
    parts.push(source.slice(cursor, edit.start), edit.text)
    cursor = edit.end
  }
  parts.push(source.slice(cursor))
  return parts.join('')
}
