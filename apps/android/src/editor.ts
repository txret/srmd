/** Edit mode: a file's text in CodeMirror, with Markdown and srmd syntax highlighted, and CodeMirror's search panel. */
import { EditorState, RangeSetBuilder, type Extension, type Text } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, keymap, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { HighlightStyle, LanguageSupport, syntaxHighlighting } from '@codemirror/language'
import { markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown'
import {
  SearchQuery, closeSearchPanel, findNext, openSearchPanel, searchKeymap, searchPanelOpen, setSearchQuery
} from '@codemirror/search'
import { tags } from '@lezer/highlight'
import type MarkdownIt from 'markdown-it'
import { m } from '@srmd/l10n'
import { parse, type SourceRange } from '@srmd/parser'
import type { FileKind } from '@srmd/workspace'

/**
 * Marks for the srmd syntax of a text: cloze markers, cloze contents and card metadata, at the parser's own record
 * offsets, so the editor shows exactly what the parser recognizes. text uses `\n` line breaks, as the parsed text does,
 * which CodeMirror counts as one position each, so offsets and positions agree, after a byte order mark starting the
 * text, which the parsed text lacks.
 */
export function srmd_marks(text: string, md: MarkdownIt): DecorationSet {
  /* The builder needs ranges by start, an enclosing one before those it encloses; markers that open nothing are text. */
  const parsed = parse(text, md)
  const shift = text.length - parsed.text.length
  const marks: [SourceRange, string][] = [
    ...parsed.clozes.map(cloze => [cloze, 'cm-srmd-cloze'] as [SourceRange, string]),
    ...parsed.markers.map(marker => [marker, 'cm-srmd-marker'] as [SourceRange, string]),
    ...[...parsed.references, ...parsed.definitions].map(metadata => [metadata, 'cm-srmd-metadata'] as [SourceRange, string])
  ]
  marks.sort(([left], [right]) => left.start.offset - right.start.offset || right.end.offset - left.end.offset)
  const builder = new RangeSetBuilder<Decoration>()
  for (const [range, name] of marks) {
    if (range.end.offset > range.start.offset) builder.add(range.start.offset + shift, range.end.offset + shift, Decoration.mark({ class: name }))
  }
  return builder.finish()
}

/**
 * Highlights srmd syntax, parsing again once typing pauses for 300 ms; meanwhile the marks move with the edits. A
 * plugin rather than a state field, as parsing a long note on every keystroke would slow typing.
 */
function srmd_highlighting(md: MarkdownIt): Extension {
  return ViewPlugin.fromClass(class {
    /** The marks shown; read by CodeMirror through the plugin's decorations. */
    decorations: DecorationSet
    /** The pending parse after the last edit, or 0. */
    private timer = 0

    /** Mark the text the editor opens with. */
    constructor(private readonly view: EditorView) {
      this.decorations = srmd_marks(text_of(view.state.doc), md)
    }

    /** Move the marks with an edit and schedule a parse of the new text. */
    update(update: ViewUpdate): void {
      /* The parse redraws through an empty transaction, whose update changes nothing here. */
      if (!update.docChanged) return
      this.decorations = this.decorations.map(update.changes)
      clearTimeout(this.timer)
      this.timer = window.setTimeout(() => {
        this.timer = 0
        this.decorations = srmd_marks(text_of(this.view.state.doc), md)
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

/** The texts of CodeMirror's search panel, and what it announces, in the language selected. */
const search_phrases = (): { [phrase: string]: string } => ({
  'Find': m.android_editor_find(), 'Replace': m.android_editor_replace(), 'next': m.android_editor_next(),
  'previous': m.android_editor_previous(), 'all': m.android_editor_all(), 'match case': m.android_editor_match_case(),
  'regexp': m.android_editor_regexp(), 'by word': m.android_editor_by_word(), 'replace': m.android_editor_replace_one(),
  'replace all': m.android_editor_replace_all(), 'close': m.android_close(), 'current match': m.android_editor_current_match(),
  'on line': m.android_editor_on_line(), 'replaced match on line $': m.android_editor_replaced_on_line(),
  'replaced $ matches': m.android_editor_replaced_matches()
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

  /**
   * Create editors in parent, the pane; on_search hears CodeMirror's search panel open or close, by its own keys and
   * buttons too, so Back can close it.
   */
  constructor(private readonly parent: HTMLElement, private readonly on_search: (open: boolean) => void) {}

  /**
   * Open a file's text, replacing any open file. Markdown files, including notes, get Markdown and srmd highlighting,
   * srmd's from parses with md, the library's. Files using CRLF line breaks keep them when saved.
   * @param original - The file's text the edit started from, when text is an edit restored from a draft; changed
   *   compares with it.
   */
  open(text: string, kind: FileKind, md: MarkdownIt, original = text): void {
    /* Choose the line separator and language, then create the editor with history and CodeMirror's search. */
    this.close()
    const lines = original.split('\n').length - 1
    const crlf = lines > 0 && original.split('\r\n').length - 1 === lines
    const language: Extension[] = kind === 'text' ? [] : [
      new LanguageSupport(markdownLanguage), syntaxHighlighting(markdown_style), srmd_highlighting(md), keymap.of(markdownKeymap)
    ]
    const state = EditorState.create({
      doc: text,
      extensions: [
        crlf ? EditorState.lineSeparator.of('\r\n') : [],
        history(), keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]), EditorView.lineWrapping, language,
        EditorState.phrases.of(search_phrases()),
        EditorView.updateListener.of(update => {
          const open = searchPanelOpen(update.state)
          if (open !== searchPanelOpen(update.startState)) this.on_search(open)
        }),
        EditorView.contentAttributes.of({ autocapitalize: 'sentences', spellcheck: 'true', autocorrect: 'on' })
      ]
    })
    this.view = new EditorView({ state, parent: this.parent })
    this.initial = state.toText(original)
  }

  /** The text being edited, with the file's line breaks. */
  get text(): string {
    return this.view?.state.doc.toString() ?? ''
  }

  /** Whether the text differs from what the file held when it opened. */
  get changed(): boolean {
    return !!this.view && !this.view.state.doc.eq(this.initial!)
  }

  /** Close the open file, discarding its editor, and with it its search panel. */
  close(): void {
    if (this.view && searchPanelOpen(this.view.state)) this.on_search(false)
    this.view?.destroy()
    this.view = null
    this.initial = null
  }

  /** Put the cursor into the text, opening the keyboard. */
  focus(): void {
    this.view?.focus()
  }

  /** Open CodeMirror's search panel, searching for query, when given, from the cursor on. */
  open_search(query = ''): void {
    const view = this.view
    if (!view) return
    openSearchPanel(view)
    if (!query) return
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: query })) })
    findNext(view)
  }

  /** Close CodeMirror's search panel. */
  close_search(): void {
    if (this.view) closeSearchPanel(this.view)
  }
}
