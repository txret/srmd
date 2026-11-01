/**
 * Source positions for markdown-it tokens. markdown-it records only line ranges (`map`) on block tokens and nothing on
 * inline tokens, while saving rewrites references and definitions at exact offsets (SYNTAX.md, "Loading and saving").
 * track_positions() makes an instance record what saving needs: each rule its block tokenize loop runs notes, when it
 * matches, which tokens it pushed and where in the text it read them, and each inline token notes where the inline
 * state stood when it was pushed, `srmd_pushed`, which for srmd's own tokens and hard breaks is where they start.
 *
 * Terminology:
 * - a span is a token's range [start, end) of offsets;
 * - a block token's span is in markdown-it's source, `state.src`: from the first character of its first line inside
 *   its containers (after a quote's `>` or at a list item's marker) to the end of its last line that is not blank
 *   there; a closing token shares the span of the token it closes;
 * - an inline token's offsets are in the content of its inline parent, the text markdown-it assembled for inline
 *   parsing: a paragraph's lines without their container prefixes and the containers' indentation, trimmed, or a table
 *   cell without its pipes and the backslashes escaping pipes, trimmed;
 * - a source map, given to the inline tokens of paragraphs and table cells, maps such content offsets back to the
 *   source.
 * Block tokens pushed by one rule invocation partition the lines it read: each starts where the rule started (the
 * first) or at its own first line.
 */
import type MarkdownIt from 'markdown-it'
import type { StateBlock, Token } from 'markdown-it'

/** A token's range [start, end) of offsets, into the source or an inline parent's content. */
export interface Span {
  start: number
  end: number
}

/**
 * How an inline token's content maps back to the source: the content offsets where runs copied from consecutive source
 * characters start, ascending, and the source offsets of those runs.
 */
export interface SourceMap {
  content: number[]
  source: number[]
}

/** A token as track_positions() leaves it. */
export interface PositionedToken extends Token {
  /** Where a block token stands (see the module comment). */
  srmd_span?: Span
  /** For the inline token of a paragraph or table cell, where its content came from. */
  srmd_map?: SourceMap
  /** state.pos when an inline rule pushed the token: where srmd's own tokens and hard breaks start in the content. */
  srmd_pushed?: number
}

/** A block rule, as markdown-it calls it. */
type BlockRule = (state: StateBlock, start_line: number, end_line: number, silent: boolean) => boolean

/** The rule arrays of block tokenize loops whose rules place their tokens, each wrapped once (see track_positions()). */
const placing = new WeakSet<BlockRule[]>()

/**
 * Make a markdown-it instance record the spans of its block tokens and where its inline tokens were pushed (see the
 * module comment). The rules of its block tokenize loop are wrapped, and its inline state replaced; plugins keep
 * working as long as their block rules push tokens in source order, as markdown-it's own do.
 * @param md - The instance, changed in place; positions cost little, but VS Code's shared instance should not get them.
 */
export function track_positions(md: MarkdownIt): void {
  /*
   * markdown-it's loop runs the rule array it compiles anew whenever plugins change the rules, so each call wraps the
   * array in use if it is new. Rules testing whether a line ends their block run other arrays, which stay unwrapped.
   */
  const tokenize = md.block.tokenize
  md.block.tokenize = function (state: StateBlock, start_line: number, end_line: number): void {
    const rules = this.ruler.getRules('') as BlockRule[]
    if (!placing.has(rules)) {
      rules.forEach((rule, index) => { rules[index] = placed(rule) })
      placing.add(rules)
    }
    tokenize.call(this, state, start_line, end_line)
  }
  const State = md.inline.State
  md.inline.State = class extends State {
    /** Push a token, noting where the state stood. */
    push(type: string, tag: string, nesting: Token['nesting']): Token {
      const token: PositionedToken = super.push(type, tag, nesting)
      token.srmd_pushed = this.pos
      return token
    }
  }
}

/** A block rule that, when it matches, places the tokens it pushed (place_blocks()). */
function placed(rule: BlockRule): BlockRule {
  return (state, start_line, end_line, silent) => {
    const count = state.tokens.length
    if (!rule(state, start_line, end_line, silent)) return false
    if (!silent) place_blocks(state, count, start_line)
    return true
  }
}

/** Map a content offset to the source: the offset in its run. Offsets before the first run map to it. */
export function to_source(map: SourceMap, offset: number): number {
  /* Binary search for the last run starting at or before the offset. */
  let low = 0
  let high = map.content.length - 1
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if (map.content[middle] <= offset) low = middle
    else high = middle - 1
  }
  return map.source[low] + Math.max(offset - map.content[low], 0)
}

/** Map a span of content to the source; an end maps after the character before it, not before the next. */
export function span_to_source(map: SourceMap, span: Span): Span {
  const start = to_source(map, span.start)
  return { start, end: span.end > span.start ? to_source(map, span.end - 1) + 1 : start }
}

/**
 * Give the tokens a block rule pushed their spans; tokens of nested blocks, placed by a nested tokenize call, keep
 * theirs. The rule's first token starts at the rule's line, any other at its own first line, both inside the
 * containers around the rule; a closing token shares the span of its opening token. The inline token of a paragraph
 * receives the paragraph's source map, those of a table's cells the cells' maps, and a cell the span of its content.
 * @param count - The number of tokens before the rule ran.
 * @param line - The line the rule started at.
 */
function place_blocks(state: StateBlock, count: number, line: number): void {
  /* Walk the new tokens once. Opening tokens wait on a stack for their closing tokens; cells are found row by row. */
  const tokens = state.tokens as PositionedToken[]
  /** Opening tokens this rule pushed and not closed yet, innermost last. */
  const open: PositionedToken[] = []
  /** Where the next cell's content can start in the table row being placed: after the cells placed before. */
  let from = 0
  for (let index = count; index < tokens.length; index++) {
    const token = tokens[index]
    if (token.srmd_span) continue
    const previous = tokens[index - 1]
    if (token.nesting === -1) {
      token.srmd_span = open.pop()?.srmd_span ?? { start: state.eMarks[line], end: state.eMarks[line] }
      continue
    }
    const first = index === count ? line : token.map?.[0]
    if (token.type === 'tr_open' && token.map) from = state.bMarks[token.map[0]] + state.tShift[token.map[0]]
    if (token.type === 'inline' && (previous?.type === 'th_open' || previous?.type === 'td_open')) {
      // A cell's tokens, without lines of their own, stand where its content does.
      const cell = cell_map(state.src, from, token.content)
      previous.srmd_span = token.srmd_span = cell.span
      token.srmd_map = cell.map
      from = cell.span.end
    } else if (first !== undefined) {
      token.srmd_span = block_span(state, first, token.map?.[1] ?? first + 1)
      // Indented code starts with its indentation, inside its containers.
      if (token.type === 'code_block') token.srmd_span.start = indented_start(state, first)
    } else {
      // Tokens without lines of their own, as plugins push, stand where the previous one starts; a cell is placed with
      // its content.
      const at = previous?.srmd_span?.start ?? state.bMarks[line] + state.tShift[line]
      token.srmd_span = { start: at, end: at }
    }
    if (token.type === 'inline' && previous?.type === 'paragraph_open' && token.map) {
      token.srmd_map = paragraph_map(state, token.map[0], token.content)
    }
    if (token.nesting === 1) open.push(token)
  }
}

/**
 * A block's span from its first line to the line before end_line, inside the current containers: from the first
 * character after their prefixes to the end of the last line that is not blank, as a list's lines can end in blank
 * lines.
 */
function block_span(state: StateBlock, first: number, end_line: number): Span {
  /* Step back over blank last lines, which isEmpty() judges inside the current containers, then read the marks. */
  let last = Math.max(end_line - 1, first)
  while (last > first && state.isEmpty(last)) last--
  return { start: state.bMarks[first] + state.tShift[first], end: state.eMarks[last] }
}

/**
 * Where indented code starts on its first line: after the containers' indentation, as markdown-it's getLines() skips
 * it, blkIndent columns, a tab counting to its tab stop and a container's prefix, which markdown-it masks as
 * indentation (tShift), one column per character.
 */
function indented_start(state: StateBlock, line: number): number {
  /* Consume characters from the line's mark until the columns are reached or text starts. */
  const line_start = state.bMarks[line]
  let at = line_start
  let column = 0
  while (at < state.eMarks[line] && column < state.blkIndent) {
    const code = state.src.charCodeAt(at)
    if (code === 0x09) column += 4 - (column + state.bsCount[line]) % 4
    else if (code === 0x20 || at - line_start < state.tShift[line]) column++
    else break
    at++
  }
  return at
}

/**
 * The source map of a paragraph's content, a run for each of its lines. markdown-it joins the paragraph's lines from
 * after their container prefixes and indentation to their ends, then trims the whole, so each content line ends where
 * its source line does, the last one before the whitespace the trim removed: each run is aligned from its line's end.
 * The spaces markdown-it writes for a partly consumed tab, which only ever start a line, map to the characters before
 * it.
 * @param first - The paragraph's first line.
 */
function paragraph_map(state: StateBlock, first: number, content: string): SourceMap {
  /* Walk the content's lines, each with its source line; only the last one was trimmed at its end. */
  const map: SourceMap = { content: [], source: [] }
  for (let start = 0, line = first; ; line++) {
    const newline = content.indexOf('\n', start)
    const length = (newline < 0 ? content.length : newline) - start
    let end = state.eMarks[line]
    if (newline < 0) {
      while (end > state.bMarks[line] && /\s/.test(state.src[end - 1])) end--
    }
    map.content.push(start)
    map.source.push(end - length)
    if (newline < 0) return map
    start = newline + 1
  }
}

/**
 * Where a table cell's content stands, and its source map. markdown-it's table rule splits a row at the pipes no
 * backslash escapes, drops the backslash before each escaped pipe, and trims each cell: so the content, its pipes
 * escaped again, is the next match in the row after the cells before it. Each pipe of the content starts a run, one
 * character further on per backslash dropped before it.
 * @param from - Where the cells before it end in the row, or where the row starts.
 */
function cell_map(src: string, from: number, content: string): { span: Span; map: SourceMap } {
  /* Find the escaped content, at the start of the rest of the row if a plugin changed it, then map its runs. */
  const escaped = content.replace(/\|/g, '\\|')
  const found = src.indexOf(escaped, from)
  const start = found < 0 ? from : found
  const map: SourceMap = { content: [0], source: [start] }
  for (let at = content.indexOf('|'), k = 1; at >= 0; at = content.indexOf('|', at + 1), k++) {
    map.content.push(at)
    map.source.push(start + at + k)
  }
  return { span: { start, end: start + escaped.length }, map }
}
