/**
 * Formatting of Markdown with GFM, srmd and the optional extensions: blocks laid out anew, inline content as written
 * unless the options say otherwise.
 *
 * mdast-util-from-markdown builds a syntax tree with the micromark extensions parse() uses, YAML front matter added,
 * and mdast-util-to-markdown writes it back: blocks one blank line apart, bullets and numbers as the options say, list
 * content indented one space after a bullet and to the next tab stop after a number, ATX headings, fenced code, `---`
 * breaks, aligned tables with their delimiter rows as the options say, and a final line ending.
 * The text in those blocks is not serialized from the tree, which would escape brackets and underscores and respell
 * links: the inline content of paragraphs, headings and table cells, and link definitions, is copied from the source
 * (see copy_text()). Only container prefixes, the indentation and trailing whitespace of lines, and hard breaks of
 * trailing spaces change. The options may then respell emphasis and strong emphasis, and wrap or join a paragraph's
 * lines (see text_rewriter()), each kept only where the text renders as before.
 *
 * srmd's inline syntax is in those copies. Its flow constructs become nodes of their own (SYNTAX.md, "Card
 * references" and "Card definitions"): a reference line keeps its references without spaces between them and stands
 * directly below the block it belongs to, unless it was farther away, which leaves its references misplaced as they
 * were; a definition keeps its fields with single spaces between them, and consecutive definitions, link definitions
 * among them, stand on consecutive lines.
 *
 * The whole result is not checked here: format() in index.ts compares its rendering with the source's.
 */
import type { Definition, Heading, List, Literal, Nodes, Paragraph, Parents, TableCell } from 'mdast'
import { fromMarkdown, type CompileContext, type Extension as FromMarkdownExtension } from 'mdast-util-from-markdown'
import { frontmatterFromMarkdown, frontmatterToMarkdown } from 'mdast-util-frontmatter'
import { gfmFromMarkdown, gfmToMarkdown } from 'mdast-util-gfm'
import { gfmTableToMarkdown } from 'mdast-util-gfm-table'
import { defaultHandlers, toMarkdown, type Handle, type Info, type Join, type Options } from 'mdast-util-to-markdown'
import { parse as create_parse_context, postprocess, preprocess } from 'micromark'
import { frontmatter } from 'micromark-extension-frontmatter'
import { gfm } from 'micromark-extension-gfm'
import type { Event, Extension, Token } from 'micromark-util-types'
import { card_syntax } from './micromark_srmd_card'
import { cloze_syntax, type MarkerToken } from './micromark_srmd_cloze'
import type { MarkdownExtension } from './types'

/** How format() writes what Markdown can write in more than one way. */
export interface FormatOptions {
  /**
   * The line breaks within paragraphs: 'preserve' keeps the source's, 'always' wraps lines at line_width, 'never' puts
   * each paragraph on one line. Hard breaks stay, and so does a line break right after an implicit cloze opener, which
   * renders differently from a space there.
   */
  wrap: 'preserve' | 'always' | 'never'
  /** The width lines wrap at, in characters, container prefixes and list markers included. */
  line_width: number
  /** Ordered list items: numbers counting up from the first item's, or the first item's number repeated. */
  numbering: 'increment' | 'repeat'
  /** The bullet of unordered lists; a list directly after another takes another bullet, which keeps them apart. */
  bullet: '-' | '*' | '+'
  /** Table delimiter rows: 'compact', `|---|:-:|`, or 'padded', `| --- | :-: |`. */
  table_delimiters: 'compact' | 'padded'
  /** The delimiters of emphasis: as written, or asterisks or underscores wherever those delimit it as well. */
  emphasis: 'preserve' | 'asterisk' | 'underscore'
  /** The delimiters of strong emphasis, likewise. */
  strong: 'preserve' | 'asterisk' | 'underscore'
}

/** The options format() takes unless given others: line breaks and emphasis as written, the notes' own list and table style. */
export const default_format_options: Readonly<FormatOptions> = {
  wrap: 'preserve', line_width: 80, numbering: 'increment', bullet: '-', table_delimiters: 'compact',
  emphasis: 'preserve', strong: 'preserve'
}

/** The values each option but the line width takes, for hosts validating and offering them; the default comes first. */
export const format_choices: { readonly [option in Exclude<keyof FormatOptions, 'line_width'>]: readonly FormatOptions[option][] } = {
  wrap: ['preserve', 'always', 'never'],
  numbering: ['increment', 'repeat'],
  bullet: ['-', '*', '+'],
  table_delimiters: ['compact', 'padded'],
  emphasis: ['preserve', 'asterisk', 'underscore'],
  strong: ['preserve', 'asterisk', 'underscore']
}

/** The narrowest line width the options accept; below it, few words would fit a line. */
export const min_line_width = 20

/**
 * The rendering of Markdown reduced to what shows; a rewritten text that renders differently from its copy is not
 * written (see text_rewriter()).
 */
export type Rendering = (markdown: string) => string

/** A card reference line in the tree: its references, without the spaces between them. */
interface CardReferenceLine extends Literal {
  type: 'cardReferenceLine'
}

/** A card definition in the tree: the line with one space after its label and between its fields. */
interface CardDefinitionLine extends Literal {
  type: 'cardDefinition'
}

/** The inline content of a paragraph, heading or table cell, copied from the source (see copy_text()). */
interface SourcePhrasing extends Literal {
  type: 'sourcePhrasing'
}

// The node types above, where mdast's content types list the nodes a parent may hold.
declare module 'mdast' {
  interface BlockContentMap {
    cardReferenceLine: CardReferenceLine
  }
  interface DefinitionContentMap {
    cardDefinition: CardDefinitionLine
  }
  interface PhrasingContentMap {
    sourcePhrasing: SourcePhrasing
  }
  interface RootContentMap {
    cardReferenceLine: CardReferenceLine
    cardDefinition: CardDefinitionLine
    sourcePhrasing: SourcePhrasing
  }
}

// GFM's tokens read here, which the types of micromark-extension-gfm do not declare.
declare module 'micromark-util-types' {
  interface TokenTypeMap {
    tableContent: 'tableContent'
    taskListCheck: 'taskListCheck'
  }
}

/**
 * Prefixes of a container's lines after its first, which the formatted container writes anew: a quote's `>` with its
 * space, and the indentation of a list item's or footnote definition's content.
 */
const container_prefixes = new Set(['blockQuotePrefix', 'listItemIndent', 'gfmFootnoteDefinitionIndent'])

/**
 * Tokens a copy of a text spells differently (see copy_text()): container prefixes; the indentation of a line, which
 * micromark leaves out of the text; spaces and tabs before a line ending, which it leaves out too, and which in a link
 * definition also separate its parts on a line; and a hard break of trailing spaces.
 */
const changed_tokens = new Set([...container_prefixes, 'linePrefix', 'lineSuffix', 'hardBreakTrailing'])

/**
 * Tokens within which a paragraph's lines may break and join: the paragraph itself, emphasis, strikethrough, and the
 * text of links and images; and code spans, whose line breaks read as spaces, although their spaces are no gaps, as
 * they are code data. Anything else, such as HTML, a link's destination or an extension's syntax, keeps its whitespace.
 */
const breakable_in = new Set([
  'content', 'paragraph', 'emphasis', 'emphasisText', 'strong', 'strongText', 'strikethrough', 'strikethroughText',
  'link', 'image', 'label', 'labelText', 'codeText'
])

/**
 * Words that may start a block when they start a line, before which a line does not break: bullets, setext underlines
 * and thematic breaks, an ATX heading's `#`, an ordered item's number, a reference line, a quote, HTML, a table row, a
 * fenced code block, a footnote definition, and Foam's block anchor, which ends the line it belongs to.
 */
const block_starts = /^(?:[-+*_=]+|#{1,6}|\d{1,9}[.)]|(?:\[:\d+\])+)$|^(?:>|<|\||`{3}|~{3}|\^|\[\^[^\]]*\]:)/

/** A word ending in an odd run of backslashes, after which a line break would be a hard break. */
const escaping_end = /(?:^|[^\\])(?:\\\\)*\\$/

/** The gap after a word of a paragraph (see words_of()). */
type Gap = 'space' | 'line' | 'forced'

/** The widths a paragraph's first line and its further lines have, after their containers' prefixes. */
type Widths = { first: number; rest: number }

/** Rewrite a copied text by the options: a paragraph's, given its widths, or another's, given null (see text_rewriter()). */
type Rewrite = (text: string, widths: Widths | null) => string

/** A text to copy: the source range of a node's inline content, or of a link definition. */
type Copy = { node: Paragraph | Heading | TableCell | Definition; start: number; end: number }

/**
 * Format Markdown without checking the result as a whole (see the module comment).
 * @param source - Complete Markdown, including any card definitions.
 * @param extensions - The optional extensions, as for parse().
 * @param options - How to write what Markdown can write in more than one way.
 * @param rendering - Renders a rewritten text and its copy for comparison (see text_rewriter()).
 * @returns The formatted Markdown with the source's line endings, and its byte order mark if it had one.
 */
export function format_markdown(
  source: string, extensions: readonly MarkdownExtension[], options: FormatOptions, rendering: Rendering
): string {
  /*
   * 1. Set aside a byte order mark and unify line endings, so offsets, copies and output all use `\n`.
   * 2. Build the tree with the micromark extensions parse() uses, after YAML front matter, which notes written for Foam
   *    start with; the srmd extension adds the card nodes and replaces the texts with their copies.
   * 3. Write it with srmd's handlers and joins and the options, then restore the line endings and the byte order mark.
   */
  const bom = source.startsWith('﻿') ? '﻿' : ''
  const newline = source.includes('\r\n') ? '\r\n' : source.includes('\r') ? '\r' : '\n'
  const text = source.slice(bom.length).replace(/\r\n?/g, '\n')

  /** The micromark extensions of parse(), which the tree and a rewritten text are tokenized with. */
  const syntax = [gfm(), ...extensions.map(extension => extension.syntax), card_syntax(), cloze_syntax()]
  /** The copies of link definitions, which the definition handler writes instead of the parsed definition. */
  const definitions = new Map<Definition, string>()
  const tree = fromMarkdown(text, {
    extensions: [frontmatter(), ...syntax],
    mdastExtensions: [frontmatterFromMarkdown(), gfmFromMarkdown(), srmd_from_markdown(text, definitions)]
  })

  const markdown = toMarkdown(tree, {
    bullet: options.bullet, bulletOther: options.bullet === '-' ? '*' : '-', bulletOrdered: '.',
    incrementListMarker: options.numbering === 'increment', listItemIndent: 'one',
    rule: '-', fence: '`', fences: true, setext: false, closeAtx: false,
    extensions: [
      frontmatterToMarkdown(), gfmToMarkdown(), srmd_to_markdown(definitions, options, text_rewriter(options, syntax, rendering))
    ]
  })
  return bom + (newline === '\n' ? markdown : markdown.replace(/\n/g, newline))
}

/**
 * The tree's srmd part: card reference lines and definitions as nodes, and the texts copied from the source.
 * @param source - The source being parsed, with `\n` line endings.
 * @param definitions - Receives the copy of each link definition.
 */
function srmd_from_markdown(source: string, definitions: Map<Definition, string>): FromMarkdownExtension {
  /*
   * Listeners see every token, around the handlers building the tree: as tokens enter, they record those that copies
   * spell differently, and as a text exits, its node, built by then, and source range. A task list item's check starts
   * its first paragraph, but the item's node writes it, so its paragraph's copy starts after it. Once the tree is
   * complete, its transform makes the copies.
   */
  /** Tokens copies spell differently, in the order they were entered. */
  const changed: Token[] = []
  /** The texts to copy, in the order they ended. */
  const copies: Copy[] = []
  /** The last task list check entered, which ends where its paragraph's copy starts. */
  let check: Token | undefined

  /** Record a node's text, after the task list check at its start if there is one. */
  const record = (node: Copy['node'] | undefined, token: Token): void => {
    if (!node) return
    const start = check && check.start.offset === token.start.offset ? check.end.offset : token.start.offset
    copies.push({ node, start, end: token.end.offset })
  }

  return {
    enter: {
      cardReferenceLine(this: CompileContext, token: Token) {
        const references = this.sliceSerialize(token).match(/\[:\d+\]/g) ?? []
        this.enter({ type: 'cardReferenceLine', value: references.join('') }, token)
      },
      cardDefinition(this: CompileContext, token: Token) {
        // The label, then the fields, which parsing found valid, so there is at least one.
        const [, label, fields] = /^(\[:\d+\]:)[ \t]*(.*?)[ \t]*$/.exec(this.sliceSerialize(token))!
        this.enter({ type: 'cardDefinition', value: `${label} ${fields.split(/[ \t]+/).join(' ')}` }, token)
      }
    },
    exit: {
      cardReferenceLine(this: CompileContext, token: Token) {
        this.exit(token)
      },
      cardDefinition(this: CompileContext, token: Token) {
        this.exit(token)
      }
    },
    beforeEnter(token) {
      if (changed_tokens.has(token.type)) changed.push(token)
      else if (token.type === 'taskListCheck') check = token
    },
    afterExit(this: CompileContext, token: Token) {
      // A paragraph or definition has just been closed, so it is the last child of the node now open; a heading or
      // table cell is still open around its text. The delimiter row's cells hold content tokens too, but have no nodes.
      const parent = this.stack[this.stack.length - 1]
      if (token.type === 'paragraph' || token.type === 'definition') {
        record((parent as Parents).children.at(-1) as Paragraph | Definition, token)
      } else if (token.type === 'atxHeadingText' || token.type === 'setextHeadingText') {
        record(parent as Heading, token)
      } else if (token.type === 'tableContent' && parent.type === 'tableCell') {
        record(parent, token)
      }
    },
    transforms: [() => {
      /* Copies and changed tokens are walked together in source order; texts do not overlap. */
      changed.sort((left, right) => left.start.offset - right.start.offset)
      copies.sort((left, right) => left.start - right.start)
      let next = 0
      for (const { node, start, end } of copies) {
        while (next < changed.length && changed[next].start.offset < start) next++
        const inside: Token[] = []
        for (let i = next; i < changed.length && changed[i].start.offset < end; i++) inside.push(changed[i])
        const copy = copy_text(source, start, end, inside)
        if (node.type === 'definition') definitions.set(node, copy)
        else {
          // An ATX heading ends at a run of `#` after a space: one ending its text is escaped. A heading whose text
          // spans lines stays a setext heading.
          const value = node.type === 'heading' && !copy.includes('\n') ? copy.replace(/(^|[ \t])(#*)#$/, '$1$2\\#') : copy
          node.children = value ? [{ type: 'sourcePhrasing', value }] : []
        }
      }
    }]
  }
}

/**
 * A text as the formatted note writes it, from its source between start and end:
 * - container prefixes are left out, as the formatted containers write them anew;
 * - so is indentation of fewer than four columns, which cannot matter; deeper indentation stays, as spaces, as without
 *   it the line could start a block, such as `#` a heading;
 * - spaces and tabs ending a line are left out, and a hard break of trailing spaces becomes a backslash, unless they
 *   follow a backslash, which they keep from being an escape or a hard break;
 * - spaces and tabs at its start, which only a task list item's text after its check has, and at its end are trimmed.
 * Line endings and everything else stay as written, such as the spaces between the parts of a link definition.
 * @param changed - The tokens inside the text in changed_tokens, in source order.
 */
function copy_text(source: string, start: number, end: number, changed: readonly Token[]): string {
  /* Copy the source between the changed tokens, writing each token's replacement. */
  let text = ''
  let at = start
  for (const token of changed) {
    text += source.slice(at, token.start.offset)
    at = token.end.offset
    const written = source.slice(token.start.offset, token.end.offset)
    if (token.type === 'linePrefix') {
      // Columns rather than characters, as a tab advances to the next tab stop.
      const width = token.end.column - token.start.column
      if (width >= 4) text += ' '.repeat(width)
    } else if (token.type === 'lineSuffix') {
      const line_end = at === end || source[at] === '\n'
      if (!line_end || text.endsWith('\\')) text += written
    } else if (token.type === 'hardBreakTrailing') {
      text += text.endsWith('\\') ? written : '\\'
    }
  }
  return (text + source.slice(at, end)).replace(/^[ \t]+|[ \t]+$/g, '')
}

/**
 * Rewrite the copied texts by the options: respell their emphasis, and wrap or join a paragraph's lines. A copy is the
 * text as written, so what a rewrite changes is checked: the copy and its rewrite are rendered alone, and a rewrite
 * rendering differently is dropped for the next candidate, down to the copy itself. The candidates are the text with
 * both changes, with its lines alone changed, and with its emphasis alone changed.
 * @param syntax - The micromark extensions the note is parsed with.
 * @returns A function rewriting a text: a paragraph's, which wraps from the column it starts at to line_width and on
 *   its further lines from the column its container's content starts at; or another, null widths, which keeps its
 *   lines.
 */
function text_rewriter(options: FormatOptions, syntax: Extension[], rendering: Rendering): Rewrite {
  /*
   * Tokenize the text alone, as rendering() renders it, for its emphasis and the places its lines may break. Respelling
   * keeps every character in place, so the events still apply to the respelled text.
   */
  const emphasis = options.emphasis === 'asterisk' ? '*' : options.emphasis === 'underscore' ? '_' : null
  const strong = options.strong === 'asterisk' ? '*' : options.strong === 'underscore' ? '_' : null
  return (text, widths) => {
    const rewrap = widths !== null && options.wrap !== 'preserve'
    if (!rewrap && !emphasis && !strong) return text
    const events = postprocess(create_parse_context({ extensions: syntax }).document().write(preprocess()(text, undefined, true)))
    const respelled = emphasis || strong ? respell_attention(text, events, emphasis, strong) : text
    /** Fill a text's words into lines, joined unless wrapping breaks them. */
    const filled = (from: string): string => fill(words_of(from, events), options.wrap, widths!.first, widths!.rest)
    const candidates = rewrap ? [filled(respelled), filled(text), respelled] : [respelled]
    /** The copy's rendering, computed once a candidate differs from it. */
    let shown: string | undefined
    for (const candidate of new Set(candidates)) {
      if (candidate === text) return text
      shown ??= rendering(text)
      if (rendering(candidate) === shown) return candidate
    }
    return text
  }
}

/**
 * A text with the delimiters of its emphasis, strong emphasis or both written with another character, where they stay
 * the delimiters of the same construct: not next to a character like them, which would join their run, and for `_` not
 * within a word, where underscores delimit nothing. Every delimiter keeps its place, as does every other character.
 * @param events - The text's events alone.
 * @param emphasis - The character emphasis takes, or null to keep it as written.
 * @param strong - The character strong emphasis takes, or null to keep it as written.
 */
function respell_attention(text: string, events: Event[], emphasis: string | null, strong: string | null): string {
  /*
   * 1. Collect each emphasis and strong token's delimiter sequences, the opening one and the closing one, in the order
   *    the tokens enter, outermost first, with a stack of the constructs open.
   * 2. Respell them in that order, deciding from the characters around a construct's sequences as respelled so far: an
   *    outer construct's sequences, respelled first, are the neighbors of the inner one's.
   */
  const constructs: { char: string | null; sequences: Token[] }[] = []
  /** Constructs entered and not exited, innermost last. */
  const open: { char: string | null; sequences: Token[] }[] = []
  for (const [kind, token] of events) {
    if (token.type === 'emphasis' || token.type === 'strong') {
      if (kind === 'exit') open.pop()
      else {
        open.push({ char: token.type === 'emphasis' ? emphasis : strong, sequences: [] })
        constructs.push(open.at(-1)!)
      }
    } else if (kind === 'enter' && (token.type === 'emphasisSequence' || token.type === 'strongSequence')) {
      open.at(-1)?.sequences.push(token)
    }
  }

  // Step 2: respell, outermost first.
  let respelled = text
  for (const { char, sequences: [opening, closing] } of constructs) {
    if (!char || !closing || respelled[opening.start.offset] === char) continue
    const before = respelled.slice(0, opening.start.offset)
    const after = respelled.slice(closing.end.offset)
    // Next to neither the same character nor, for `_`, a word's letters or digits: whitespace, punctuation, an end.
    const in_word = char === '_' && ((before && !/[\s\p{P}\p{S}]$/u.test(before)) || (after && !/^[\s\p{P}\p{S}]/u.test(after)))
    if (in_word || before.endsWith(char) || after.startsWith(char)) continue
    for (const { start, end } of [opening, closing]) {
      respelled = respelled.slice(0, start.offset) + char.repeat(end.offset - start.offset) + respelled.slice(end.offset)
    }
  }
  return respelled
}

/**
 * A paragraph's text as words, which no line break enters, and the gaps after them but the last: 'space' where the
 * text has spaces or tabs, 'line' where it has a line break, which wrapping may also join, and 'forced' for a line
 * break that stays, after a hard break or an implicit cloze opener. Gaps are only in the paragraph's own text and that
 * of its emphasis and links, and at the line breaks of its code spans (see breakable_in); a wiki link,
 * `[[target|label]]`, is a word too.
 * @param text - The text, or its respelling, which has the same events.
 * @param events - The events of the text alone.
 */
function words_of(text: string, events: Event[]): { words: string[]; gaps: Gap[] } {
  /*
   * 1. Mark each character: 0 for part of a word, 1 for a space or tab of a gap, 2 for a line ending, 3 for a line
   *    ending that stays. A token's whitespace is a gap only when every token around it is in breakable_in, which
   *    `blocked` counts.
   * 2. Unmark wiki links, which Foam reads only on one line, whether the extension tokenized them or not.
   * 3. Split the text at runs of gap characters; a run's gap is its strongest mark.
   */
  const marks = new Uint8Array(text.length)
  /** The tokens entered and not exited that are not in breakable_in. */
  let blocked = 0
  /** Where implicit openers and hard breaks end: a line ending there stays. */
  const sticky = new Set<number>()
  for (const [kind, token] of events) {
    const passes = breakable_in.has(token.type)
    if (kind === 'exit') {
      if (!passes) blocked--
      continue
    }
    const free = blocked === 0
    if (!passes) blocked++
    const { offset: start } = token.start
    const { offset: end } = token.end
    if ((token.type === 'clozeOpen' && !(token as MarkerToken)._explicit) || token.type === 'hardBreakEscape' ||
      token.type === 'hardBreakTrailing') sticky.add(end)
    if (!free) continue
    if (token.type === 'lineEnding') marks[start] = sticky.has(start) ? 3 : 2
    else if (token.type === 'data' || token.type === 'linePrefix' || token.type === 'lineSuffix') {
      for (let i = start; i < end; i++) if (text[i] === ' ' || text[i] === '\t') marks[i] = 1
    }
  }
  for (const link of text.matchAll(/!?\[\[[^\]\n]*\]\]/g)) marks.fill(0, link.index, link.index + link[0].length)

  // Step 3: words and gaps.
  const words: string[] = []
  const gaps: Gap[] = []
  let word = ''
  let gap = 0
  for (let i = 0; i < text.length; i++) {
    if (!marks[i]) {
      if (gap) {
        words.push(word)
        gaps.push(gap === 3 ? 'forced' : gap === 2 ? 'line' : 'space')
        word = ''
        gap = 0
      }
      word += text[i]
    } else gap = Math.max(gap, marks[i])
  }
  words.push(word)
  return { words, gaps }
}

/**
 * Fill words into lines: each gap becomes a space, but a forced one a line break, and with wrap 'always' so does one
 * after which the next word would end past the width. A word that is too long stands on a line of its own; a line does
 * not break before a word that would start a block there, or after one ending in an escaping backslash.
 * @param first - The width the first line has, after its container's prefixes and markers.
 * @param rest - The width further lines have.
 */
function fill({ words, gaps }: { words: string[]; gaps: Gap[] }, wrap: FormatOptions['wrap'], first: number, rest: number): string {
  /*
   * Widths count characters by code point; the width of the line so far decides each break. A word keeps a line break
   * it holds, as a code span across lines does, and the width counts on from there.
   */
  const width = (word: string): number => [...word].length
  let text = ''
  let used = 0
  let available = first
  for (let i = 0; i < words.length; i++) {
    const word = words[i]
    const breaks = i > 0 && !block_starts.test(word) && !escaping_end.test(words[i - 1])
    if (i > 0 && (gaps[i - 1] === 'forced' || (wrap === 'always' && breaks && used + 1 + width(word) > available))) {
      text += '\n'
      used = 0
      available = rest
    } else if (i > 0) {
      text += ' '
      used++
    }
    text += word
    const line_break = word.lastIndexOf('\n')
    if (line_break >= 0) available = rest
    used = line_break >= 0 ? width(word.slice(line_break + 1)) : used + width(word)
  }
  return text
}

/**
 * The writing of the srmd nodes and copied texts, the options' styles, and the line breaks srmd's flow constructs need.
 * @param definitions - The copies of link definitions.
 * @param rewrite - Rewrites a copied text by the options (see text_rewriter()).
 */
function srmd_to_markdown(definitions: Map<Definition, string>, options: FormatOptions, rewrite: Rewrite): Options {
  /** Write a literal node's value: card nodes are written as they are. */
  const value: Handle = (node: Literal) => node.value
  /** GFM's table handler, which pads the cells of each column to one width. */
  const table = gfmTableToMarkdown().handlers!.table!
  return {
    handlers: {
      /**
       * A copied text, rewritten by the options. A paragraph's lines wrap from the column the handler is at, after its
       * containers' prefixes and markers, and further lines at the column its containers indent them to.
       */
      sourcePhrasing(node: SourcePhrasing, parent, _state, info: Info) {
        const widths = parent?.type === 'paragraph'
          ? { first: options.line_width - (info.now.column - 1), rest: options.line_width - info.lineShift }
          : null
        return rewrite(node.value, widths)
      },
      cardReferenceLine: value,
      cardDefinition: value,
      /** A link definition as copied. */
      definition(node: Definition, parent, state, info) {
        return definitions.get(node) ?? defaultHandlers.definition(node, parent, state, info)
      },
      /**
       * A table as GFM writes it; with compact delimiters, its delimiter row, the second line, without spaces and its
       * dashes as wide as the cells: `| --- | :-: |` written `|-----|:---:|`.
       */
      table(node, parent, state, info) {
        const lines = table(node, parent, state, info).split('\n')
        if (options.table_delimiters === 'compact') {
          lines[1] = lines[1].split('|').map((cell, index, cells) => index === 0 || index === cells.length - 1 ? cell
            : (/^ ?:/.test(cell) ? ':' : '-') + '-'.repeat(cell.length - 2) + (/: ?$/.test(cell) ? ':' : '-')).join('|')
        }
        return lines.join('\n')
      },
      /** `---`, except right below a paragraph in a tight list item, where it would underline it as a heading. */
      thematicBreak(node, parent, state) {
        return below_paragraph(node, parent) && is_tight(parent) ? '***' : defaultHandlers.thematicBreak(node, parent, state)
      },
      /**
       * A list with its items' content indented as notes write it: one space after a bullet, `- item`, and to the next
       * tab stop after a number, `1.  item`. The option applies to the list's own items, and nested lists set their own.
       */
      list(node: List, parent, state, info) {
        const indent = state.options.listItemIndent
        state.options.listItemIndent = node.ordered ? 'tab' : 'one'
        try {
          return defaultHandlers.list(node, parent, state, info)
        } finally {
          state.options.listItemIndent = indent
        }
      }
    },
    join: [join_srmd]
  }
}

/**
 * The blank lines between two blocks where srmd or a tight list item decides, or undefined to leave them to
 * mdast-util-to-markdown's own rules, which separate blocks by a blank line, and the blocks of tight list items by none:
 * - a card reference line follows its block directly, but one blank line below in a loose list item, where leaving it
 *   out would make the list tight, and below HTML, which only a blank line ends; one farther than a blank line from the
 *   block above it belongs to no card, and stays two blank lines away (see positions.ts);
 * - definitions follow each other directly, except in a loose list item;
 * - a thematic break follows a paragraph in a tight list item directly, written with asterisks (see the handler).
 */
const join_srmd: Join = (left, right, parent) => {
  /* A loose list item keeps a blank line between each two of its blocks: without them, its list would render tight. */
  const loose = 'spread' in parent && parent.spread === true
  if (right.type === 'cardReferenceLine') {
    const gap = right.position && left.position ? right.position.start.line - left.position.end.line - 1 : 0
    if (gap > 1) return 2
    return loose || left.type === 'html' ? 1 : 0
  }
  if (is_definition(left) && is_definition(right) && !loose) return 0
  if (left.type === 'paragraph' && right.type === 'thematicBreak' && is_tight(parent)) return 0
  return undefined
}

/** Whether a node is a link definition or a card definition. */
function is_definition(node: Nodes): boolean {
  return node.type === 'definition' || node.type === 'cardDefinition'
}

/** Whether a parent is a tight list item, whose blocks follow each other without blank lines. */
function is_tight(parent: Parents | undefined): boolean {
  return parent?.type === 'listItem' && parent.spread === false
}

/** Whether node directly follows a paragraph in parent. */
function below_paragraph(node: Nodes, parent: Parents | undefined): boolean {
  const index = parent ? (parent.children as Nodes[]).indexOf(node) : -1
  return index > 0 && parent!.children[index - 1].type === 'paragraph'
}
