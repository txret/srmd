/**
 * Public entry point for the shared Markdown pipeline, on markdown-it (see instance.ts): parse(source) ->
 * render(parsed); serialize(parsed, scheduling) when a review changes scheduling, and persist_hints(parsed, scheduling)
 * when the scheduler resolved the note's hints. Neither the API nor the inspection CLI writes the note to disk.
 */
import type MarkdownIt from 'markdown-it'
import { shared_markdown_it } from './instance'
import type { ParsedNote, Scheduling, SrmdEnv } from './types'

export { persist_hints, serialize } from './serialize'
export { has_scheduling, is_hint, serialize_card } from './cards'
export { shared_markdown_it, srmd_plugin, type PluginOptions } from './instance'
export type {
  CardDefinition, CardReference, Cards, Cloze, DefinitionProblem, Group, Hint, Insertion,
  ParsedNote, Point, Scheduling, SourceRange, SrmdEnv
} from './types'

/** Options of render(). */
export interface RenderOptions {
  /** Replacement cards, one per card in ordinal order; omitted, the cards the parse found are shown. */
  scheduling?: readonly Scheduling[]
}

/**
 * Parse a note once, finding its cards and metadata. The note is parsed as its text: without a byte order mark, its
 * line endings `\n` (see ParsedNote), which markdown-it parses as it is.
 * @param source - Complete Markdown, including any card definitions.
 * @param md - An instance recording positions: srmd's own, shared_markdown_it(), by default, or one with
 *   srmd_plugin()'s `positions` among other plugins; a parse of any other renders, but cannot be saved.
 * @returns The note's tokens and cards, ordinal-ordered, with their stored fields unchanged.
 */
export function parse(source: string, md: MarkdownIt = shared_markdown_it()): ParsedNote {
  const text = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const env: { srmd: SrmdEnv } = { srmd: {} }
  const tokens = md.parse(text, env)
  const cards = env.srmd.cards ?? { groups: [], references: [], definitions: [], scheduling: [], hints: [], problems: [], clozes: [], markers: [] }
  return { ...cards, source, text, md, tokens, env }
}

/**
 * Render a parsed note, hiding metadata and exposing scheduling on cloze elements (SYNTAX.md, "HTML").
 * @returns HTML, with markdown-it's escaping, its blocks on lines of their own but without a final line ending; raw
 *   HTML in the note shows as text.
 */
export function render(parsed: ParsedNote, options: RenderOptions = {}): string {
  const env = { ...parsed.env, srmd: { ...parsed.env.srmd, ...options } }
  return parsed.md.renderer.render(parsed.tokens, parsed.md.options, env).replace(/\n$/, '')
}
