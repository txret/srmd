/**
 * Reference positions (SYNTAX.md, "Card references"): each card has one position where its reference belongs, its
 * key, and each reference stands at one; a reference where no card's position is, is misplaced. Ownership is
 * decided by match_cards() in cards.ts. A key is one of:
 * - `t<offset>`, the end of a text: offset is the end of the last content before the reference in its paragraph or
 *   table cell, skipping whitespace, line endings and other references. An implicit inline cloze's
 *   position ends its content; an explicit cloze's follows its closing marker, which counts as content here; a
 *   block cloze whose last block is a paragraph ends that paragraph's text.
 * - `l<offset>`, a reference line after the block starting at offset, in the same parent, with at most one blank
 *   line between: the position of a block cloze whose last block is not a paragraph. A reference line interrupts
 *   a paragraph, so after a list, quote or table it ends them, and lists and quotes are blocks like any other.
 */
import type { Event, Token } from 'micromark-util-types'
import type { CardParserState, CardReference, ClozeToken, Insertion } from './types'

/** Tokens that are not content of a text: a reference after them follows the content before them. */
const not_content = new Set([
  'lineEnding', 'lineEndingBlank', 'linePrefix', 'lineSuffix', 'whitespace', 'cardReference', 'inlineCloze'
])
/** GFM's literal URLs, which run to the next whitespace or `<`; literal email addresses end at their domain. */
const literal_urls = new Set(['literalAutolinkHttp', 'literalAutolinkWww'])
/** Tokens holding text whose end a reference can follow; a hidden paragraph can hold a closing marker. */
const texts = new Set(['paragraph', 'clozeEmptyParagraph', 'tableHeader', 'tableData'])
/** Blocks and their wrappers: each records the last block that ended in it. */
const blocks = new Set([
  'content', 'paragraph', 'clozeEmptyParagraph', 'listOrdered', 'listUnordered', 'blockQuote', 'codeFenced',
  'codeIndented', 'htmlFlow', 'table', 'atxHeading', 'setextHeading', 'thematicBreak', 'blockCloze',
  'cardReferenceLine', 'cardDefinition', 'definition'
])
/** Blocks that are neither a cloze's last block nor the block a reference line follows. */
const skipped = new Set(['clozeEmptyParagraph', 'cardReferenceLine', 'cardDefinition', 'definition'])
/** HTML blocks of kinds 1 to 5 end at their end condition; kinds 6 and 7 continue until a blank line. */
const self_ending_html = /^[ \t]*<(?:(?:script|pre|style|textarea)(?=[\s>]|$)|!--|\?|![A-Za-z]|!\[CDATA\[)/i

/**
 * An open block during locate(). last is the last block that ended in it; last_line the line where anything in it
 * last ended, to count the blank lines before a reference line.
 */
type Frame = { last?: Token; last_line: number }

/**
 * Give every card reference its position, and every card its position, nesting order and insertion.
 * @param events - Resolved events from resolve_clozes(), in render order.
 * @param state - The parse's records; references and groups receive their positions here.
 */
export function locate(events: Event[], state: CardParserState): void {
  /*
   * 1. Walk the events once. Track the end of content in the current text: a reference in text takes it as its
   *    key, and a reference line the key of the block above its content. Record the last block that ended in each
   *    block, each paragraph's text end, and each cloze's exit index.
   * 2. Derive each card's key and insertion from its first cloze.
   */
  const source = state.source
  /** Open blocks, the document first. */
  const stack: Frame[] = [{ last_line: 0 }]
  /** The last block that ended in each block, read for block clozes. */
  const last_of = new Map<Token, Token | undefined>()
  /** The text end of each paragraph, where a block cloze ending in it takes its reference. */
  const text_end_of = new Map<Token, number | undefined>()
  /** Each inline cloze's content end: the text end at its exit, undefined when the cloze added no content. */
  const content_ends = new Map<Token, number | undefined>()
  /** Exit index of every cloze: inner clozes exit first, so it orders the cards sharing a position. */
  const exits = new Map<Token, number>()
  /** Text ends that are implicit openers' ends: a reference written there needs a space to keep the opener. */
  const marker_ends = new Set<number>()
  /** Start offsets of literal URLs, which a reference written after them without a space would continue. */
  const url_starts = new Set<number>()
  /** The end of the last content in the current text. */
  let text_end: number | undefined
  /** The key of the reference line being walked. */
  let line_key: string | undefined

  // Step 1: one walk over the resolved events.
  for (let i = 0; i < events.length; i++) {
    const [kind, token] = events[i]
    const entering = kind === 'enter'
    if (entering && texts.has(token.type)) text_end = undefined
    if (!entering && (token.type === 'inlineCloze' || token.type === 'blockCloze')) exits.set(token, i)
    // At an inline cloze's enter, remember the text end so far; at its exit, keep the end only if it moved.
    if (token.type === 'inlineCloze') content_ends.set(token, entering || text_end !== content_ends.get(token) ? text_end : undefined)

    if (blocks.has(token.type)) {
      if (entering) {
        // A reference line follows the block above it, one blank line at most.
        const parent = stack[stack.length - 1]
        if (token.type === 'cardReferenceLine') {
          line_key = parent.last && token.start.line - parent.last_line <= 2 ? `l${parent.last.start.offset}` : undefined
        }
        stack.push({ last_line: 0 })
        continue
      }
      const frame = stack.pop()!
      const parent = stack[stack.length - 1]
      last_of.set(token, frame.last)
      if (token.type === 'paragraph') text_end_of.set(token, text_end)
      // Wrappers stand for their last block.
      const block = token.type === 'content' || token.type === 'blockCloze' ? frame.last : skipped.has(token.type) ? undefined : token
      if (block) parent.last = block
      parent.last_line = token.end.line
      continue
    }
    if (entering && token.type === 'cardReference') {
      const reference = token as CardReference
      reference.key = reference.line ? line_key : text_end === undefined ? undefined : `t${text_end}`
    }
    if (entering || not_content.has(token.type)) continue
    if (token.type !== 'data' || source.slice(token.start.offset, token.end.offset).trim()) {
      // Content: everything else, including markers. Data ends before its trailing whitespace.
      let end = token.end.offset
      while (token.type === 'data' && /\s/.test(source[end - 1])) end--
      text_end = end
      if (token.type === 'clozeOpen') marker_ends.add(end)
      if (literal_urls.has(token.type)) url_starts.add(token.start.offset)
    }
  }

  // Step 2: each card's key and insertion, from its first cloze.
  for (const group of state.groups) {
    const cloze: ClozeToken = group.first_cloze
    group.nesting = exits.get(cloze)!
    if (cloze._closer_end !== undefined) {
      group.key = `t${cloze._closer_end}`
      group.insertion = { kind: 'inline', offset: cloze._closer_end, space: false }
      continue
    }
    // An implicit inline cloze ends its content; a block cloze its last block: at the end of its text when it is a
    // paragraph, else on a line after it.
    let end: number | undefined
    if (cloze.type === 'inlineCloze') end = content_ends.get(cloze)
    else {
      const block = last_of.get(cloze)
      if (block && block.type !== 'paragraph') {
        group.key = `l${block.start.offset}`
        group.insertion = line_insertion(block, source)
        continue
      }
      end = block && text_end_of.get(block)
    }
    if (end === undefined) continue
    group.key = `t${end}`
    group.insertion = { kind: 'inline', offset: end, space: marker_ends.has(end) || needs_space(source, end, url_starts) }
  }
}

/**
 * Whether a reference written at offset needs a space before it: after `!`, `![` would start an image; after an
 * odd run of backslashes `\[` would be escaped; and after a literal URL, such as `https://example.com/a`, the
 * reference would become part of it, also with only punctuation such as `.` between.
 * @param url_starts - Start offsets of the literal URLs in the source.
 */
function needs_space(source: string, offset: number, url_starts: Set<number>): boolean {
  /*
   * 1. Check the character before the offset for `!`.
   * 2. A literal URL runs to the next whitespace or `<`: look for one starting since the last of those.
   * 3. Backslashes escape in pairs; count the run before the offset.
   */
  if (source[offset - 1] === '!') return true
  for (let at = offset - 1; at >= 0 && !/[\s<]/.test(source[at]); at--) {
    if (url_starts.has(at)) return true
  }
  let slashes = 0
  while (offset > 0 && source[--offset] === '\\') slashes++
  return slashes % 2 === 1
}

/**
 * Write a reference line after a block, with the line prefix of its containers: the text before the block on its
 * first line, list markers as spaces (`> `, list indentation). Only an HTML block of kind 6 or 7, which takes the
 * next line as content, needs a blank line first; a reference line ends any other block.
 */
function line_insertion(block: Token, source: string): Insertion {
  /* Find the block's first line for the prefix, and its end before trailing spaces. */
  let start = block.start.offset
  while (start > 0 && source[start - 1] !== '\n' && source[start - 1] !== '\r') start--
  let end = block.end.offset
  while (source[end - 1] === ' ' || source[end - 1] === '\t') end--
  const prefix = source.slice(start, block.start.offset).replace(/[^\t >]/g, ' ')
  return { kind: 'line', offset: end, prefix, blank: block.type === 'htmlFlow' && !self_ending_html.test(source.slice(block.start.offset)) }
}
