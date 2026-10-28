/**
 * Edit mode: a file's text in CodeMirror, with Markdown and srmd syntax highlighted, the note search's matches, and
 * formatting.
 */
import { EditorState, RangeSetBuilder, StateEffect, StateField, type ChangeSpec, type Extension, type Text } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, keymap, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, isolateHistory } from '@codemirror/commands'
import { HighlightStyle, LanguageSupport, syntaxHighlighting } from '@codemirror/language'
import { markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown'
import { SearchCursor } from '@codemirror/search'
import { tags } from '@lezer/highlight'
import { format, parse, type FormatOptions, type MarkdownExtension } from '@srmd/parser'
import type { FileKind } from '@srmd/workspace'

/** The class of each srmd token the editor marks, by micromark token type (see the parser's TokenTypeMap). */
const srmd_classes: { [type: string]: string } = {
  clozeOpen: 'cm-srmd-marker',
  clozeClose: 'cm-srmd-marker',
  inlineCloze: 'cm-srmd-cloze',
  blockCloze: 'cm-srmd-cloze',
  cardReference: 'cm-srmd-metadata',
  cardDefinition: 'cm-srmd-metadata'
}

/**
 * Marks for the srmd syntax of a text: cloze markers, cloze contents and card metadata, at the parser's own token
 * offsets, so the editor shows exactly what the parser recognizes. text uses `\n` line breaks, which CodeMirror counts
 * as one position each, so offsets and positions agree.
 */
export function srmd_marks(text: string, extensions: readonly MarkdownExtension[]): DecorationSet {
  /* Enter events come in document order, outer tokens first, which is the order the builder needs. */
  const builder = new RangeSetBuilder<Decoration>()
  for (const [kind, token] of parse(text, extensions).events) {
    const name = kind === 'enter' ? srmd_classes[token.type] : undefined
    if (name && token.end.offset > token.start.offset) builder.add(token.start.offset, token.end.offset, Decoration.mark({ class: name }))
  }
  return builder.finish()
}

/**
 * Highlights srmd syntax, parsing again once typing pauses for 300 ms; meanwhile the marks move with the edits. A
 * plugin rather than a state field, as parsing a long note on every keystroke would slow typing.
 */
function srmd_highlighting(extensions: readonly MarkdownExtension[]): Extension {
  return ViewPlugin.fromClass(class {
    /** The marks shown; read by CodeMirror through the plugin's decorations. */
    decorations: DecorationSet
    /** The pending parse after the last edit, or 0. */
    private timer = 0

    /** Mark the text the editor opens with. */
    constructor(private readonly view: EditorView) {
      this.decorations = srmd_marks(text_of(view.state.doc), extensions)
    }

    /** Move the marks with an edit and schedule a parse of the new text. */
    update(update: ViewUpdate): void {
      /* The parse redraws through an empty transaction, whose update changes nothing here. */
      if (!update.docChanged) return
      this.decorations = this.decorations.map(update.changes)
      clearTimeout(this.timer)
      this.timer = window.setTimeout(() => {
        this.timer = 0
        this.decorations = srmd_marks(text_of(this.view.state.doc), extensions)
        this.view.dispatch({})
      }, 300)
    }

    /** Cancel a pending parse when the editor closes. */
    destroy(): void {
      clearTimeout(this.timer)
    }
  }, { decorations: plugin => plugin.decorations })
}

/** A document's text with `\n` line breaks, whatever the file uses, for parsing at CodeMirror positions. */
const text_of = (doc: Text): string => doc.sliceString(0, doc.length, '\n')

/** The most pairs of lines line_changes() compares, such as a thousand changed lines with a thousand; four bytes each. */
const COMPARED_LINES = 1_000_000

/**
 * The changes turning text into changed, as CodeMirror applies them to text: the lines both have, in the same order,
 * stay, so the cursor and marks on them stay too. The lines kept are the common first and last lines, and between them
 * a longest common subsequence; more lines between them than COMPARED_LINES allows are replaced whole.
 * @param text - The text changed, with `\n` line breaks, as are CodeMirror's positions.
 * @param changed - The new text, with `\n` line breaks.
 * @returns Changes at positions in text, in order, not overlapping.
 */
export function line_changes(text: string, changed: string): ChangeSpec[] {
  /*
   * 1. Split both texts into lines, which joined by `\n` give the texts back, and set aside the common first and last.
   * 2. Between them, find a longest common subsequence: lengths[i * width + j] is the length of a longest common
   *    subsequence of the old lines from i and the new lines from j. The table is filled from the ends, then followed
   *    from the starts.
   * 3. Each run of lines between two kept ones, or a kept one and an end, becomes one change: lines replaced by lines,
   *    or lines inserted or removed with the line break that separates them from their neighbors.
   */
  const old_lines = text.split('\n')
  const new_lines = changed.split('\n')
  let head = 0
  while (head < old_lines.length && head < new_lines.length && old_lines[head] === new_lines[head]) head++
  let tail = 0
  while (tail < old_lines.length - head && tail < new_lines.length - head &&
    old_lines[old_lines.length - 1 - tail] === new_lines[new_lines.length - 1 - tail]) tail++

  // Step 2: the kept lines between, as [old index, new index] pairs in order.
  const old_count = old_lines.length - head - tail
  const new_count = new_lines.length - head - tail
  const kept: [number, number][] = []
  if (old_count * new_count <= COMPARED_LINES) {
    const width = new_count + 1
    const lengths = new Uint32Array((old_count + 1) * width)
    for (let i = old_count - 1; i >= 0; i--) {
      for (let j = new_count - 1; j >= 0; j--) {
        lengths[i * width + j] = old_lines[head + i] === new_lines[head + j]
          ? lengths[(i + 1) * width + j + 1] + 1
          : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1])
      }
    }
    for (let i = 0, j = 0; i < old_count && j < new_count;) {
      if (old_lines[head + i] === new_lines[head + j]) kept.push([head + i++, head + j++])
      else if (lengths[(i + 1) * width + j] >= lengths[i * width + j + 1]) i++
      else j++
    }
  }

  // Step 3: the runs between kept lines, the last one ending where the common last lines start.
  /** Where each old line starts in text; a line ends where the next starts, less its line break. */
  const starts: number[] = []
  for (let i = 0, at = 0; i < old_lines.length; at += old_lines[i++].length + 1) starts.push(at)
  const changes: ChangeSpec[] = []
  let old_at = head
  let new_at = head
  for (const [old_kept, new_kept] of [...kept, [old_lines.length - tail, new_lines.length - tail]]) {
    const insert = new_lines.slice(new_at, new_kept).join('\n')
    if (old_kept > old_at && new_kept > new_at) {
      changes.push({ from: starts[old_at], to: starts[old_kept - 1] + old_lines[old_kept - 1].length, insert })
    } else if (new_kept > new_at) {
      // Inserted lines go before the next old line, or after the last one.
      if (old_at < old_lines.length) changes.push({ from: starts[old_at], insert: insert + '\n' })
      else changes.push({ from: text.length, insert: '\n' + insert })
    } else if (old_kept > old_at) {
      // Removed lines go with the line break after them, or before them at the end, as some line always remains.
      if (old_kept < old_lines.length) changes.push({ from: starts[old_at], to: starts[old_kept] })
      else changes.push({ from: starts[old_at] - 1, to: text.length })
    }
    old_at = old_kept + 1
    new_at = new_kept + 1
  }
  return changes
}

/** Replaces the search matches shown: their ranges in document order, and the index of the current one. */
const set_matches = StateEffect.define<{ ranges: { from: number; to: number }[]; current: number }>()

/** The note search's matches, marked; the current one stands out. Edits move them; a new search replaces them. */
const matches_field = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  /** The marks after a transaction: a new search's, or the previous ones moved with the edit. */
  update(marks, transaction) {
    /* Apply the latest search, otherwise follow the edit. */
    for (const effect of transaction.effects) {
      if (!effect.is(set_matches)) continue
      const { ranges, current } = effect.value
      return Decoration.set(ranges.map(({ from, to }, index) =>
        Decoration.mark({ class: index === current ? 'cm-search-match current' : 'cm-search-match' }).range(from, to)))
    }
    return marks.map(transaction.changes)
  },
  provide: field => EditorView.decorations.from(field)
})

/** Markdown highlighting in the app's colors, defined in CSS by class. */
const markdown_style = HighlightStyle.define([
  { tag: tags.heading, class: 'cm-md-heading' },
  { tag: tags.emphasis, class: 'cm-md-emphasis' },
  { tag: tags.strong, class: 'cm-md-strong' },
  { tag: tags.strikethrough, class: 'cm-md-strike' },
  { tag: [tags.link, tags.url], class: 'cm-md-link' },
  { tag: tags.monospace, class: 'cm-md-code' },
  { tag: tags.quote, class: 'cm-md-quote' },
  { tag: [tags.processingInstruction, tags.contentSeparator, tags.labelName], class: 'cm-md-markup' }
])

/**
 * The editor pane: one file at a time. Its changes are compared with the document it opened with, so a file whose line
 * breaks CodeMirror would write differently does not count as changed until edited.
 */
export class Editor {
  /** The editor, or null while no file is open. */
  private view: EditorView | null = null
  /** The document as opened, which changed compares with. */
  private initial: Text | null = null
  /** The optional Markdown extensions of the open file, which format() formats it with. */
  private extensions: readonly MarkdownExtension[] = []
  /** The query whose matches are marked, and the current match's index among them. */
  private query = ''
  private current = -1

  /**
   * Create editors in parent, the pane.
   * @param on_format - Runs on Shift+Alt+F in a Markdown file, as in VS Code, to format it as the app's button does.
   */
  constructor(private readonly parent: HTMLElement, private readonly on_format: () => void) {}

  /**
   * Open a file's text, replacing any open file. Markdown files, including notes, get Markdown and srmd highlighting,
   * and Shift+Alt+F to format them. Files using CRLF line breaks keep them when saved.
   * @param original - The file's text the edit started from, when text is an edit restored from a draft; changed
   *   compares with it.
   */
  open(text: string, kind: FileKind, extensions: readonly MarkdownExtension[], original = text): void {
    /* Choose the line separator and language, then create the editor with history and the search marks. */
    this.close()
    this.extensions = extensions
    const lines = original.split('\n').length - 1
    const crlf = lines > 0 && original.split('\r\n').length - 1 === lines
    const format_key = { key: 'Shift-Alt-f', run: () => { this.on_format(); return true } }
    const language: Extension[] = kind === 'text' ? [] : [
      new LanguageSupport(markdownLanguage), syntaxHighlighting(markdown_style), srmd_highlighting(extensions),
      keymap.of([...markdownKeymap, format_key])
    ]
    const state = EditorState.create({
      doc: text,
      extensions: [
        crlf ? EditorState.lineSeparator.of('\r\n') : [],
        history(), keymap.of([...defaultKeymap, ...historyKeymap]), EditorView.lineWrapping, matches_field, language,
        EditorView.contentAttributes.of({ autocapitalize: 'sentences', spellcheck: 'true', autocorrect: 'on' })
      ]
    })
    this.view = new EditorView({ state, parent: this.parent })
    this.initial = state.toText(original)
    this.query = ''
    this.current = -1
  }

  /** The text being edited, with the file's line breaks. */
  get text(): string {
    return this.view?.state.doc.toString() ?? ''
  }

  /**
   * Format the text as Markdown with the parser's format(), as one step of the history, which typing before or after
   * does not join; the lines formatting leaves alone keep the cursor and the search's marks (see line_changes()).
   * @param options - How to write what Markdown can write in more than one way, from the settings.
   * @returns 'formatted'; 'unchanged' when the text is formatted already; 'refused' when the formatted text would
   *   render differently, a defect of the formatter, which leaves the text as it is.
   */
  format(options: FormatOptions): 'formatted' | 'unchanged' | 'refused' {
    const view = this.view
    if (!view) return 'unchanged'
    const text = text_of(view.state.doc)
    const formatted = format(text, this.extensions, options)
    if (formatted === null) return 'refused'
    if (formatted === text) return 'unchanged'
    view.dispatch({ changes: line_changes(text, formatted), userEvent: 'input.format', annotations: isolateHistory.of('full') })
    return 'formatted'
  }

  /** Whether the text differs from what the file held when it opened. */
  get changed(): boolean {
    return !!this.view && !this.view.state.doc.eq(this.initial!)
  }

  /** Close the open file, discarding its editor. */
  close(): void {
    this.view?.destroy()
    this.view = null
    this.initial = null
  }

  /** Put the cursor into the text, opening the keyboard. */
  focus(): void {
    this.view?.focus()
  }

  /**
   * Mark every match of query, ignoring case, and make the next or previous one current, scrolling to it. A new query
   * starts at the first match after the cursor. Returns the current match's index and the number of matches.
   */
  find(query: string, backward: boolean): { index: number; total: number } {
    /* Collect the matches, choose the current one, then mark them all and scroll in one transaction. */
    const view = this.view
    if (!view || !query) {
      this.clear_search()
      return { index: -1, total: 0 }
    }
    const ranges: { from: number; to: number }[] = []
    const cursor = new SearchCursor(view.state.doc, query, 0, view.state.doc.length, text => text.toLowerCase())
    for (let next = cursor.next(); !next.done; next = cursor.next()) ranges.push({ from: next.value.from, to: next.value.to })
    if (!ranges.length) {
      this.query = query
      this.current = -1
      view.dispatch({ effects: set_matches.of({ ranges, current: -1 }) })
      return { index: -1, total: 0 }
    }
    if (query !== this.query || this.current < 0) {
      const head = view.state.selection.main.head
      const after = ranges.findIndex(range => range.from >= head)
      this.current = backward ? (after > 0 ? after - 1 : ranges.length - 1) : Math.max(after, 0)
    } else {
      this.current = (this.current + (backward ? ranges.length - 1 : 1)) % ranges.length
    }
    this.query = query
    const { from } = ranges[this.current]
    view.dispatch({ effects: [set_matches.of({ ranges, current: this.current }), EditorView.scrollIntoView(from, { y: 'center' })] })
    return { index: this.current, total: ranges.length }
  }

  /** Remove the search's marks. */
  clear_search(): void {
    this.query = ''
    this.current = -1
    this.view?.dispatch({ effects: set_matches.of({ ranges: [], current: -1 }) })
  }
}
