/**
 * Public entry point for the shared Markdown pipeline:
 * parse(source, extensions) -> render(events, options); serialize(parsed, scheduling) when a review changes
 * scheduling, and persist_hints(parsed.source, parsed.hints, scheduling) when the scheduler resolved the note's
 * hints; format(source, extensions, options) when the user formats a note. Neither the API nor the inspection CLI
 * writes the note to disk.
 *
 * GFM and srmd are built in; other micromark extensions are optional, given by the caller.
 */
import { compile, parse as create_parse_context, postprocess, preprocess } from 'micromark'
import { gfm, gfmHtml as gfm_html } from 'micromark-extension-gfm'
import { combineExtensions as combine_extensions } from 'micromark-util-combine-extensions'
import type { Event, Extension } from 'micromark-util-types'
import { card_html, card_syntax } from './micromark_srmd_card'
import { cloze_html, cloze_syntax, resolve_clozes } from './micromark_srmd_cloze'
import { match_cards } from './cards'
import { default_format_options, format_markdown, type FormatOptions } from './format'
import { locate } from './positions'
import type { MarkdownExtension, ParsedNote, Scheduling } from './types'

export { default_format_options, format_choices, min_line_width, type FormatOptions } from './format'
export { persist_hints, serialize } from './serialize'
export { has_scheduling, is_hint, serialize_card } from './cards'
export { transcribe, type Transcript, type TranscriptBlockCloze, type TranscriptCloze, type TranscriptMarks } from './transcribe'
export type { CardDefinition, CardReference, DefinitionProblem, Group, Hint, Insertion, MarkdownExtension, ParsedNote, Scheduling } from './types'

/** Options of render(). */
export interface RenderOptions {
  /** The extensions the events were parsed with, such as ParsedNote.extensions. */
  extensions?: readonly MarkdownExtension[]
  /** Replacement cards, one per card in ordinal order; omitted, the cards attached by parse() are used. */
  scheduling?: readonly Scheduling[]
}

/** No optional extensions, parse()'s default, a list of its own so parses without extensions share their syntax. */
const no_extensions: readonly MarkdownExtension[] = []

/**
 * The note syntax for each list of optional extensions: GFM, the extensions and srmd, combined once. Syntax
 * descriptions hold no state of a parse, so every note parsed with a list shares them; hosts keep one list until their
 * settings change, and a list no longer used is released with its syntax.
 */
const syntaxes = new WeakMap<readonly MarkdownExtension[], Extension>()

/** The note syntax for a list of optional extensions (see syntaxes). */
function syntax_of(extensions: readonly MarkdownExtension[]): Extension {
  let syntax = syntaxes.get(extensions)
  if (!syntax) {
    syntax = combine_extensions([gfm(), ...extensions.map(extension => extension.syntax), card_syntax(), cloze_syntax()])
    syntaxes.set(extensions, syntax)
  }
  return syntax
}

/**
 * Tokenize the original Markdown once and match scheduling without normalizing.
 * @param source - Complete Markdown, including any card definitions.
 * @param extensions - Optional extensions, applied after GFM and before srmd.
 * @returns Untouched source, live events, ordinal-ordered cards with their stored fields unchanged.
 */
export function parse(source: string, extensions: readonly MarkdownExtension[] = no_extensions): ParsedNote {
  /*
   * Uses the Micromark pipeline step by step rather than the do-all function as we need access to the events
   * 1. Create the Markdown parsing context with the note syntax: GFM, the optional extensions and srmd (card
   *    metadata, clozes), combined once per list of extensions; initialize the context's per-note records.
   * 2. Tokenize the original source and expand Markdown chunks through postprocess().
   * 3. Resolve clozes, locate reference positions, then match references and definitions to cards.
   * 4. Return the original source, resolved events, current cards and the matched records serialize() needs,
   *    without normalizing.
   */
  // Micromark owns block/inline parsing, escapes, code and forward definitions; each note has a context of its own.
  const ctx = create_parse_context({ extensions: [syntax_of(extensions)] })
  ctx.card_state = { source, groups: [], references: [], definitions: [] }
  const document = ctx.document()
  const events = postprocess(document.write(preprocess()(source, undefined, true)))
  const state = ctx.card_state
  // Complete cloze boundaries once Markdown chunks have expanded, then match the cards and metadata retained by
  // that resolver. No source reparse.
  const resolved = resolve_clozes(events, document)
  locate(resolved, state)
  const { scheduling, hints, problems } = match_cards(state)
  return {
    source, events: resolved, extensions, scheduling, groups: state.groups, references: state.references,
    definitions: state.definitions, hints, problems
  }
}

/**
 * Compile live events, hiding metadata and exposing current scheduling on cloze elements.
 * @param events - Live events from {@link parse}, retaining contexts.
 * @param options - The extensions the events were parsed with, and replacement cards.
 * @returns HTML using micromark's default escaping and the extension handlers.
 */
export function render(events: Event[], options: RenderOptions = {}): string {
  return compile({ htmlExtensions: [
    gfm_html(), ...(options.extensions ?? []).map(extension => extension.html), card_html(), cloze_html(options.scheduling)
  ] })(events)
}

/**
 * Format Markdown (see format.ts): blocks laid out anew, inline content as written unless the options respell its
 * emphasis or wrap its paragraphs. Formatting must not change what a note says, so the result is rendered and compared
 * with the source's rendering, clozes and their scheduling included; so is each text the options rewrite.
 * @param source - Complete Markdown, including any card definitions.
 * @param extensions - The optional extensions, as for parse().
 * @param options - How to write what Markdown can write in more than one way; default_format_options for the others.
 * @returns The formatted Markdown, the source itself when it is formatted already, or null when the formatted text
 *   would render differently: a defect of the formatter, after which hosts leave the source as it is and say so.
 */
export function format(
  source: string, extensions: readonly MarkdownExtension[] = [], options: Partial<FormatOptions> = {}
): string | null {
  const rendering = (markdown: string): string => shown_html(markdown, extensions)
  const formatted = format_markdown(source, extensions, { ...default_format_options, ...options }, rendering)
  if (formatted === source) return source
  return rendering(formatted) === rendering(source) ? formatted : null
}

/** Block elements of rendered notes, before and after which whitespace does not show. */
const block_tags = /[ \t\r\n]*(<\/?(?:blockquote|div|h[1-6]|hr|li|ol|p|section|table|tbody|td|th|thead|tr|ul)\b[^>]*>)[ \t\r\n]*/g

/**
 * Render Markdown keeping only whitespace that shows, which formatting may change: line endings and spaces around block
 * elements go, and any other run of spaces, tabs and line endings becomes one space, such as the spaces after a task
 * list item's check or a line break that wrapping moved. Code keeps its whitespace: a code span exactly, a code block
 * but for the kind of line ending and a final one, which a code block left open at the end of a note lacks until
 * formatting closes it.
 */
function shown_html(markdown: string, extensions: readonly MarkdownExtension[]): string {
  /*
   * Split off code blocks and spans, which take the odd places, then reduce the whitespace between them; a space next
   * to a code block, which is a block element too, or at an end of the note goes as well.
   */
  return render(parse(markdown, extensions).events, { extensions })
    .split(/(<pre>[\s\S]*?<\/pre>|<code>[\s\S]*?<\/code>)/)
    .map((part, index) => index % 2 === 0 ? part.replace(block_tags, '$1').replace(/[ \t\r\n]+/g, ' ')
      : part.startsWith('<pre>') ? part.replace(/\r\n?/g, '\n').replace(/\n<\/code><\/pre>$/, '</code></pre>') : part)
    .join('')
    .replace(/ (?=<pre>)|(?<=<\/pre>) |^ | $/g, '')
}
