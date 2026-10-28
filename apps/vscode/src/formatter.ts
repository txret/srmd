import * as vscode from 'vscode'
import { m } from '@srmd/l10n'
import { format } from '@srmd/parser'
import { uri_to_str } from './filesystem'
import type { Settings } from './settings'

/**
 * A glob matching the paths that end with suffix. Glob characters in the suffix stand alone in brackets, where they
 * match themselves.
 */
const suffix_glob = (suffix: string): string => `**/*${suffix.replace(/[*?[{}]/g, '[$&]')}`

/**
 * The formatter of notes, the files with a note suffix, while srmd is on: VS Code's Format Document and format on
 * save run the shared format() on them (ARCHITECTURE.md, "Formatting"). Other Markdown files keep their formatters.
 */
export class NoteFormatter implements vscode.Disposable {
  /** The provider's registration for the note suffixes applied last; null while srmd is off. */
  private registration: vscode.Disposable | null = null
  /** The globs registered, as one string, so settings keeping them do not register again. */
  private globs = ''

  /**
   * Create the formatter unregistered; update() registers it.
   * @param settings - The settings in effect, read at every format, so changed extensions and formatting settings apply
   *   at the next one.
   * @param log - Receives the notes left unformatted.
   */
  constructor(private readonly settings: () => Settings, private readonly log: vscode.LogOutputChannel) {}

  /** Register for the note suffixes of the settings in effect while srmd is on; while it is off, for nothing. */
  update(): void {
    /* Replace the registration only when the globs changed. */
    const { enabled, suffixes } = this.settings()
    const globs = enabled ? suffixes.map(suffix_glob) : []
    if (globs.join('\n') === this.globs) return
    this.dispose()
    this.globs = globs.join('\n')
    if (!globs.length) return
    this.registration = vscode.languages.registerDocumentFormattingEditProvider(globs.map(pattern => ({ pattern })), {
      provideDocumentFormattingEdits: document => this.edits(document)
    })
  }

  /**
   * Format a note: one edit replacing its text, or none when it is formatted already. A note that would render
   * differently stays as it is, with a warning and a log entry, as that is a defect of the formatter.
   */
  private edits(document: vscode.TextDocument): vscode.TextEdit[] {
    /*
     * Format the text with the parser's extensions and the formatting settings; VS Code reduces the edit to the lines
     * that changed.
     */
    const text = document.getText()
    const { extensions, format: options } = this.settings()
    const formatted = format(text, extensions, options)
    if (formatted === null) {
      const message = m.vscode_format_refused({ path: uri_to_str(document.uri) })
      this.log.warn(message)
      void vscode.window.showWarningMessage(message)
      return []
    }
    if (formatted === text) return []
    return [vscode.TextEdit.replace(new vscode.Range(document.positionAt(0), document.positionAt(text.length)), formatted)]
  }

  /** Unregister the provider. */
  dispose(): void {
    this.registration?.dispose()
    this.registration = null
    this.globs = ''
  }
}
