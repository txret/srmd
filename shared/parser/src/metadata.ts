/**
 * The blocks srmd's source positions take as metadata, which any instance recording positions needs (see
 * srmd_plugin()), besides srmd's own definitions and reference lines:
 * - YAML front matter, which notes written for Foam start with: a `front_matter` token, showing nothing.
 * - Link reference definitions as tokens of their own, `srmd_link_definition`, showing nothing: markdown-it keeps them
 *   in the environment only, while srmd's positions need them where they stand.
 * - A byte order mark starting the Markdown is no text: parse() takes it off notes, and this rule off what other
 *   parses read, such as the files a note embeds.
 * Metadata is never a pending opener's answer, a cloze's last block or what a reference line follows.
 */
/// <reference path="./modules.d.ts" />
import type MarkdownIt from 'markdown-it'
import type { StateBlock } from 'markdown-it'
import reference from 'markdown-it/lib/rules_block/reference.mjs'

/**
 * YAML front matter at the very start of the note: a `---` line, then lines up to a closing `---` or `...` line.
 * Without a closing line there is none, and `---` is a thematic break.
 */
function front_matter(state: StateBlock, start_line: number, end_line: number, silent: boolean): boolean {
  /* Only the document's first line can open it, outside any container; then find the closing line. */
  if (start_line !== 0 || state.bMarks[0] + state.tShift[0] !== 0) return false
  const line_text = (line: number): string => state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line])
  if (!/^---[ \t]*$/.test(line_text(0))) return false
  let close = 1
  while (close < end_line && !/^(?:---|\.\.\.)[ \t]*$/.test(line_text(close))) close++
  if (close >= end_line) return false
  if (silent) return true
  const token = state.push('front_matter', '', 0)
  token.map = [0, close + 1]
  token.markup = '---'
  token.content = state.getLines(1, close, 0, false)
  state.line = close + 1
  return true
}

/**
 * markdown-it's rule for link reference definitions, followed by a token standing for the definitions read, with
 * their lines without container prefixes as its content.
 */
function link_definition(state: StateBlock, start_line: number, end_line: number, silent: boolean): boolean {
  if (!reference(state, start_line, end_line, silent)) return false
  if (silent) return true
  const token = state.push('srmd_link_definition', '', 0)
  token.map = [start_line, state.line]
  token.content = state.getLines(start_line, state.line, state.blkIndent, false)
  return true
}

/**
 * Give an instance the blocks srmd's positions take as metadata (see the module comment): front matter and link
 * reference definitions as tokens showing nothing, and a byte order mark dropped.
 * @param md - The instance, changed in place, before srmd's syntax is added, whose rules go before the same rules.
 */
export function srmd_metadata(md: MarkdownIt): void {
  md.block.ruler.before('table', 'front_matter', front_matter)
  md.block.ruler.at('reference', link_definition)
  md.core.ruler.after('normalize', 'byte_order_mark', state => {
    if (state.src.charCodeAt(0) === 0xfeff) state.src = state.src.slice(1)
  })
  md.renderer.rules.front_matter = md.renderer.rules.srmd_link_definition = () => ''
}
