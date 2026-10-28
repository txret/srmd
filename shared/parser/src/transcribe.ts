/**
 * Transcription of a note into Markdown without srmd syntax, for Markdown renderers other than render(), such as
 * the markdown-it of VS Code's Markdown preview, which add their own syntax and features.
 *
 * The transcript keeps every line of the source and its block structure, so a renderer's line numbers point into
 * the note and its blocks are the note's blocks. srmd syntax is therefore replaced rather than deleted:
 * - an implicit opener becomes the colon the review shows; an explicit marker or a card reference becomes the
 *   caller's filler mark. Deleting a marker alone on its line would leave a blank line, which can end a paragraph
 *   or loosen a list, and punctuation in its place keeps emphasis delimiters next to it meaning what they meant next
 *   to the marker's own punctuation, and keeps delimiter runs such as `**a**[:1]**b**` apart;
 * - a card definition or reference line becomes a thematic break, `___`. Like a reference line it interrupts a
 *   paragraph and ends a lazy list or quote line, which definitions never need, and unlike a blank line it leaves
 *   a list tight; unlike `---` it is never a setext underline;
 * - an inline cloze's content stands between the caller's open and close marks.
 * The caller finds the marks in its renderer's output, removes the filler and the listed thematic breaks, and wraps
 * the block clozes, which are given as line ranges.
 */
import type { Token } from 'micromark-util-types'
import type { MarkerToken } from './micromark_srmd_cloze'
import type { CardReference, ClozeToken, ParsedNote, Scheduling } from './types'

/**
 * Single characters transcribe() writes, which the caller finds by character, so none may occur in the source.
 * Non-ASCII Unicode punctuation has no Markdown meaning of its own, and Markdown's emphasis rules treat it as they
 * treat the markers' own punctuation.
 */
export interface TranscriptMarks {
  /** Before an inline cloze's content. */
  open: string
  /** After an inline cloze's content. */
  close: string
  /** In place of an explicit cloze marker or a card reference. */
  filler: string
}

/** A cloze of a transcript, with what the review shows in its data-ordinal and data-card attributes. */
export interface TranscriptCloze {
  ordinal: number
  scheduling: Scheduling
}

/** A block cloze of a transcript: the blocks of its container from its start line through its end line. */
export interface TranscriptBlockCloze extends TranscriptCloze {
  /** Zero-based line where its first block starts. */
  start_line: number
  /** Zero-based line where it ends: the last line of its last block, which holds the closer of an explicit cloze. */
  end_line: number
  /** The block quotes and lists containing it, outermost first. */
  containers: ('quote' | 'list')[]
}

/** A note as transcribe() returns it. */
export interface Transcript {
  /** The source with its srmd syntax replaced, line for line. */
  markdown: string
  /** Inline clozes in the order of their open marks. */
  inline: TranscriptCloze[]
  /** Block clozes in the order they start, so a cloze precedes the clozes it contains. */
  block: TranscriptBlockCloze[]
  /** Zero-based lines where a card definition or reference line became `___`. */
  metadata_lines: number[]
}

/** A replacement of source[start, end) by text; an insertion when start equals end. */
type Edit = { start: number; end: number; text: string }

/**
 * Tokens that are not content of a cloze, so marks stay outside them and a block cloze does not end on their line:
 * whitespace, and the line endings and container prefixes between lines; markers and references, which render
 * nothing or an opener's colon; hard breaks, which end implicit clozes; card metadata lines; and quotes and lists,
 * which end after the next line's container prefix rather than with their content.
 */
const not_content = new Set([
  'lineEnding', 'lineEndingBlank', 'linePrefix', 'lineSuffix', 'whitespace', 'listItemIndent', 'blockQuotePrefix',
  'blockQuoteMarker', 'blockQuotePrefixWhitespace', 'hardBreakEscape', 'hardBreakTrailing', 'clozeOpen', 'clozeClose',
  'cardReference', 'cardReferenceLine', 'cardDefinition', 'blockQuote', 'listOrdered', 'listUnordered'
])

/**
 * Transcribe a parsed note into Markdown without srmd syntax, marking where its clozes are (see the module comment).
 * @param parsed - A parse from parse(), with the extensions the renderer's syntax corresponds to.
 * @param marks - Characters absent from the source.
 * @returns The transcript; each cloze has the scheduling its card's definition stores.
 */
export function transcribe(parsed: ParsedNote, marks: TranscriptMarks): Transcript {
  /*
   * 1. Walk the events once, collecting edits of the source and the clozes:
   *    - markers, references, definitions and reference lines are replaced; markers in headings and others that
   *      became text are text and stay;
   *    - an inline cloze's open mark goes before its first content token and its close mark after its last, so
   *      whitespace and line endings at its edges, and markers and references, stay outside it;
   *    - a block cloze records its first line, the line where its last content token ends, and its containers.
   * 2. Apply the edits in source order.
   */
  const { source } = parsed
  const edits: Edit[] = []
  const transcript: Transcript = { markdown: '', inline: [], block: [], metadata_lines: [] }
  /** The quotes and lists around the current event, which a block cloze records when it starts. */
  const containers: ('quote' | 'list')[] = []
  /**
   * Inline clozes entered and not exited, innermost last, with the offset of their open mark: -1 until their first
   * content token, before which the mark goes.
   */
  const inline: { cloze: TranscriptCloze; open: number }[] = []
  /** Block clozes entered and not exited, innermost last; each takes its end line when it exits. */
  const blocks: TranscriptBlockCloze[] = []
  /**
   * Where the content token exited last ends, without spaces ending a text: an inline cloze's close mark goes there,
   * and a block cloze ends on its line.
   */
  let content_end = 0
  let content_line = 1

  /** Replace a token's source with text. */
  const replace = (token: Token, text: string): void => {
    edits.push({ start: token.start.offset, end: token.end.offset, text })
  }
  /** Put an inline cloze's open mark at offset; the clozes are listed in the order of these marks. */
  const open = (entry: { cloze: TranscriptCloze; open: number }, offset: number): void => {
    entry.open = offset
    edits.push({ start: offset, end: offset, text: marks.open })
    transcript.inline.push(entry.cloze)
  }

  // 1. Collect the edits and clozes.
  for (const [kind, token] of parsed.events) {
    const entering = kind === 'enter'
    const cloze = token as ClozeToken
    if (token.type === 'inlineCloze') {
      if (entering) inline.push({ cloze: { ordinal: cloze._ordinal, scheduling: cloze._scheduling }, open: -1 })
      else {
        // A cloze without content gets both marks where it starts.
        const entry = inline.pop()!
        if (entry.open < 0) open(entry, token.start.offset)
        const close = Math.max(content_end, entry.open)
        edits.push({ start: close, end: close, text: marks.close })
      }
      continue
    }
    if (token.type === 'blockCloze') {
      if (entering) {
        const line = token.start.line - 1
        const block = { ordinal: cloze._ordinal, scheduling: cloze._scheduling, start_line: line, end_line: line, containers: [...containers] }
        transcript.block.push(block)
        blocks.push(block)
      } else blocks.pop()!.end_line = content_line - 1
      continue
    }

    if (entering) {
      if (token.type === 'clozeOpen') {
        const marker = token as MarkerToken
        replace(token, marker._explicit ? marks.filler : marker._value!)
      } else if (token.type === 'clozeClose') {
        replace(token, marks.filler)
      } else if (token.type === 'cardReference') {
        // References filling a line go with the line.
        if (!(token as CardReference).line) replace(token, marks.filler)
      } else if (token.type === 'cardDefinition' || token.type === 'cardReferenceLine') {
        replace(token, '___')
        transcript.metadata_lines.push(token.start.line - 1)
      } else if (token.type === 'blockQuote') {
        containers.push('quote')
      } else if (token.type === 'listOrdered' || token.type === 'listUnordered') {
        containers.push('list')
      }
    } else if (token.type === 'blockQuote' || token.type === 'listOrdered' || token.type === 'listUnordered') {
      containers.pop()
    }

    // Content receives the open marks still waiting for it, and its end is where a close mark would go. The
    // spaces at the edges of a text stay outside the marks.
    const data = token.type === 'data'
    const text = data ? source.slice(token.start.offset, token.end.offset) : ''
    if (!not_content.has(token.type) && (!data || text.trim() !== '')) {
      if (entering) {
        const start = token.start.offset + (data ? /^[ \t]*/.exec(text)![0].length : 0)
        for (const entry of inline) if (entry.open < 0) open(entry, start)
      } else {
        content_end = token.end.offset - (data ? /[ \t]*$/.exec(text)![0].length : 0)
        content_line = token.end.line
      }
    }
  }

  // 2. Apply the edits. At equal offsets, insertions precede a replacement; otherwise collection order holds.
  edits.sort((a, b) => a.start - b.start || Number(a.end > a.start) - Number(b.end > b.start))
  let at = 0
  for (const edit of edits) {
    transcript.markdown += source.slice(at, edit.start) + edit.text
    at = edit.end
  }
  transcript.markdown += source.slice(at)
  return transcript
}
