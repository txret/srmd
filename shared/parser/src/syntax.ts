/**
 * markdown-it rules for srmd syntax (SYNTAX.md), tokens of markdown-it's own kinds:
 * - A card definition, `[:1]: k 20261012040000 7 ...`, is a block token of its line, `srmd_definition`; it starts
 *   where a paragraph could, like a link reference definition, and is tried before those.
 * - A reference line, `[:1]` or `[:2][:1]`, is a block token, `srmd_reference_line`, holding its references; like a
 *   thematic break it interrupts a paragraph and ends a lazy list, quote or table line.
 * - Cloze markers and card references are inline tokens: `srmd_opener` (`::`, `:;`, `::>`, ...), `srmd_closer` (`<::`,
 *   ...) and `srmd_reference` (`[:1]`). Whether a marker opens or closes anything is decided with the whole token
 *   stream by the cloze rule (clozes.ts), which turns markers that do neither into text.
 * Every token keeps the text it was read from as its markup.
 */
import type MarkdownIt from 'markdown-it'
import type { StateBlock, StateInline } from 'markdown-it'
import { is_identifier, read_definition } from './cards'
import type { Scheduling } from './types'

/** What the cloze rule needs to know of a marker token, `srmd_opener`. */
export interface MarkerMeta {
  /** Marker symbols, colons and the optional final semicolon: the group's symbol count. */
  level: number
  /** Ends in a semicolon: continues the latest group of the same level. */
  continuation: boolean
  /** Ends in `>`: closed by a closing marker rather than by Markdown structure. */
  explicit: boolean
  /** What the marker renders, set by the cloze rule: a colon and spaces, a colon, or nothing for explicit markers. */
  value?: string
}

/** A reference of a reference line: its identifier and where it stands in the normalized source. */
export interface LineReference {
  ref: number
  start: number
  end: number
}

/**
 * Whether srmd syntax applies to a parse: when its environment carries `env.srmd`, which parse() sets, and hosts set
 * for what they render as a note or inside one. An instance that parses other documents too, such as VS Code's
 * preview's, leaves them alone, as their parses carry none.
 */
export function applies(env: unknown): boolean {
  return (env as { srmd?: unknown } | undefined)?.srmd !== undefined
}

/** Whether a character code is a space or tab, which separate markers and references from what follows them. */
const is_space = (code: number): boolean => code === 0x20 || code === 0x09

/**
 * The end of a card reference `[:n]` starting at pos, or -1 if none does.
 * @param max - Where the text ends: references do not run past a link's text.
 */
function reference_end(src: string, pos: number, max: number): number {
  if (src.charCodeAt(pos) !== 0x5b /*[*/ || src.charCodeAt(pos + 1) !== 0x3a /*:*/) return -1
  let end = pos + 2
  while (end < max && src.charCodeAt(end) >= 0x30 && src.charCodeAt(end) <= 0x39) end++
  return end < max && src.charCodeAt(end) === 0x5d /*]*/ && is_identifier(src.slice(pos + 2, end)) ? end + 1 : -1
}

/**
 * Register srmd's rules on a markdown-it instance (see the module comment); the cloze rule and the renderer are
 * separate (see index.ts).
 * @param md - The instance, changed in place.
 */
export function srmd_syntax(md: MarkdownIt): void {
  /*
   * Block rules go before markdown-it's reference rule, which `[:1]: k` would satisfy as well; a reference line may
   * end the blocks a thematic break ends. Inline rules go before the rules that take `:`, `<` and `[` otherwise.
   * Each applies only where srmd syntax does (applies()).
   */

  /**
   * A card definition: one line, indented at most three columns past its container's content, holding a valid
   * definition. It never interrupts a paragraph, which takes the line as text.
   */
  function definition(state: StateBlock, start_line: number, _end_line: number, silent: boolean): boolean {
    if (state.sCount[start_line] - state.blkIndent >= 4 || !applies(state.env)) return false
    const start = state.bMarks[start_line] + state.tShift[start_line]
    const end = state.eMarks[start_line]
    if (state.src.charCodeAt(start) !== 0x5b /*[*/ || state.src.charCodeAt(start + 1) !== 0x3a /*:*/) return false
    const scheduling: Scheduling | null = read_definition(state.src.slice(start, end))
    if (!scheduling) return false
    if (silent) return true
    const token = state.push('srmd_definition', '', 0)
    token.map = [start_line, start_line + 1]
    token.markup = state.src.slice(start, end)
    token.meta = scheduling
    state.line = start_line + 1
    return true
  }

  /** A reference line: one or more references, separated by spaces or tabs, and nothing else. */
  function reference_line(state: StateBlock, start_line: number, _end_line: number, silent: boolean): boolean {
    /* Read references and the spaces after them up to the line's end; anything else leaves the line to others. */
    if (state.sCount[start_line] - state.blkIndent >= 4 || !applies(state.env)) return false
    const start = state.bMarks[start_line] + state.tShift[start_line]
    const max = state.eMarks[start_line]
    const references: LineReference[] = []
    let pos = start
    while (pos < max) {
      const end = reference_end(state.src, pos, max)
      if (end < 0) return false
      references.push({ ref: Number(state.src.slice(pos + 2, end - 1)), start: pos, end })
      pos = end
      while (pos < max && is_space(state.src.charCodeAt(pos))) pos++
    }
    if (!references.length) return false
    if (silent) return true
    const token = state.push('srmd_reference_line', '', 0)
    token.map = [start_line, start_line + 1]
    token.markup = state.src.slice(start, max)
    token.meta = references
    state.line = start_line + 1
    return true
  }

  /**
   * A cloze opener at `:`: two or more symbols, colons with an optional final semicolon, then `>` (explicit) or a
   * space, tab, line ending or the end of the text (implicit). An implicit opener takes the spaces after it, which
   * separate it from its answer. The end of a link's text is no end of the text: `[a::](b)` holds no opener.
   */
  function opener(state: StateInline, silent: boolean): boolean {
    /* Count the symbols, then classify the marker by the character after them. */
    const src = state.src
    if (src.charCodeAt(state.pos) !== 0x3a /*:*/ || !applies(state.env)) return false
    let pos = state.pos + 1
    let level = 1
    let continuation = false
    while (pos < state.posMax && !continuation && (src.charCodeAt(pos) === 0x3a || src.charCodeAt(pos) === 0x3b)) {
      continuation = src.charCodeAt(pos) === 0x3b /*;*/
      level++
      pos++
    }
    if (level < 2) return false
    const next = pos < src.length ? src.charCodeAt(pos) : -1
    const explicit = next === 0x3e /*>*/ && pos < state.posMax
    if (explicit) pos++
    else if (next !== -1 && next !== 0x0a && !is_space(next)) return false
    else while (pos < state.posMax && is_space(src.charCodeAt(pos))) pos++
    if (!silent) {
      const token = state.push('srmd_opener', '', 0)
      token.markup = src.slice(state.pos, pos)
      token.meta = { level, continuation, explicit } satisfies MarkerMeta
    }
    state.pos = pos
    return true
  }

  /**
   * A closing marker at `<`: two or more symbols, colons with an optional final semicolon. The symbols select no
   * group; the cloze rule decides what the marker closes.
   */
  function closer(state: StateInline, silent: boolean): boolean {
    const src = state.src
    if (src.charCodeAt(state.pos) !== 0x3c /*<*/ || !applies(state.env)) return false
    let pos = state.pos + 1
    let continuation = false
    while (pos < state.posMax && !continuation && (src.charCodeAt(pos) === 0x3a || src.charCodeAt(pos) === 0x3b)) {
      continuation = src.charCodeAt(pos) === 0x3b /*;*/
      pos++
    }
    if (pos - state.pos - 1 < 2) return false
    if (!silent) state.push('srmd_closer', '', 0).markup = src.slice(state.pos, pos)
    state.pos = pos
    return true
  }

  /**
   * A card reference at `[`. At the start of a line or of the text, `[:1]:` is the label of a definition that failed
   * validation, which stays text, so saving preserves it.
   */
  function reference(state: StateInline, silent: boolean): boolean {
    if (!applies(state.env)) return false
    const end = reference_end(state.src, state.pos, state.posMax)
    if (end < 0) return false
    const line_start = state.pos === 0 || state.src.charCodeAt(state.pos - 1) === 0x0a
    if (line_start && state.src.charCodeAt(end) === 0x3a /*:*/) return false
    if (!silent) {
      const token = state.push('srmd_reference', '', 0)
      token.markup = state.src.slice(state.pos, end)
      token.meta = Number(state.src.slice(state.pos + 2, end - 1))
    }
    state.pos = end
    return true
  }

  const interrupts = ['paragraph', 'reference', 'blockquote', 'list']
  md.block.ruler.before('reference', 'srmd_reference_line', reference_line, { alt: interrupts })
  md.block.ruler.before('reference', 'srmd_definition', definition)
  md.inline.ruler.before('linkify', 'srmd_opener', opener)
  md.inline.ruler.before('autolink', 'srmd_closer', closer)
  md.inline.ruler.before('link', 'srmd_reference', reference)
}
