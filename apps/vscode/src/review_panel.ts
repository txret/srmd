import * as vscode from 'vscode'
import { getLocale, m } from '@srmd/l10n'
import { get_name, type ReviewRating } from '@srmd/scheduler'
import { review_rating, type ReviewData } from '@srmd/reviewer'
import { compile_html, escape_html, type UIConfig } from '@srmd/ui'
import { error_text, type PreparedCard } from '@srmd/workspace'
import { str_to_uri } from './filesystem'
import type { CardMessage, ReviewerMessage } from './reviewer'
import type { Workspace } from './workspace'

/** How the wait for one displayed card ended: a rating, the tab closing, or a retarget skipping it unrated. */
type CardResult = { type: 'rated'; rating: ReviewRating } | { type: 'closed' } | { type: 'skipped' }

/**
 * The single review tab. Reviewing another note or folder while it is open retargets the tab instead of
 * opening a second one. Card selection and rating+save run as workspace tasks; waiting for the user does not.
 *
 * The webview document is set once per tab. It reports `ready` when it listens, then receives each card
 * as a message and answers with the card's rating, so cards change without reloading scripts or styles.
 */
export class ReviewPanel implements vscode.Disposable {
  /** The open review tab, or null. */
  private panel: vscode.WebviewPanel | null = null
  /** Workspace-relative note or folder path whose cards the tab serves; read anew for every card. */
  private scope = ''
  /** The card shown, or waiting for the document to become ready; sent again whenever the document reloads. */
  private card: CardMessage | null = null
  /** The note and parse of the card shown, which Show Note opens at the card. */
  private shown: PreparedCard | null = null
  /** Whether the tab's document listens for cards. */
  private ready = false
  /** Ends the wait for the current card: with its rating, because the tab closed, or skipped by a retarget. */
  private settle: ((result: CardResult) => void) | null = null
  /** Identifies each card sent, so a rating for an earlier card is ignored. */
  private next_id = 1

  /** Serve cards from workspace, rendering them with the shared reviewer and the extension's media files; log records failures. */
  constructor(
    private readonly extension_uri: vscode.Uri, private readonly workspace: Workspace,
    private readonly config: UIConfig, private readonly log: vscode.LogOutputChannel
  ) {}

  /**
   * Review a note or folder path. With the tab open, a different scope retargets it and the call returns
   * at once; otherwise the call resolves when that review ends, closing the tab in every case.
   */
  async review(scope: string): Promise<void> {
    /* Retarget an open tab, or open one and run its loop, reporting unexpected failures. */
    const name = get_name(scope) || (vscode.workspace.workspaceFolders?.[0]?.name ?? m.vscode_workspace())
    const title = m.vscode_panel_title({ name })
    if (this.panel) {
      this.panel.reveal()
      if (scope === this.scope) return
      this.scope = scope
      this.panel.title = title
      this.settle?.({ type: 'skipped' })
      return
    }

    this.scope = scope
    const panel = this.open(title)
    try {
      await this.run(panel)
    } catch (error: unknown) {
      const message = m.vscode_review_failed({ detail: error_text(error) })
      this.log.error(message)
      void vscode.window.showErrorMessage(message)
    } finally {
      panel.dispose()
    }
  }

  /** Load the open tab's document again, so changed display settings apply; the current card is sent again. */
  reload(): void {
    if (!this.panel) return
    this.ready = false
    this.panel.webview.html = this.document(this.panel.webview)
  }

  /**
   * Show the note of the card on display with the cursor on its first cloze: in the tab group that already has it
   * open, otherwise in a new tab beside the review, which stays visible.
   */
  async show_note(): Promise<void> {
    /* Find an open tab for the note, show the note there or beside the review, then place the cursor at the card. */
    if (!this.panel || !this.shown) return
    const { path, ordinal, parsed } = this.shown
    const uri = str_to_uri(path)
    const group = vscode.window.tabGroups.all.find(group => group.tabs.some(tab =>
      tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri.toString()))
    const editor = await vscode.window.showTextDocument(uri, { viewColumn: group?.viewColumn ?? vscode.ViewColumn.Beside, preview: false })
    // The card was shown from this parse, so its offsets locate the cloze in the note's text.
    const position = editor.document.positionAt(parsed.groups[ordinal - 1].first_cloze.start.offset)
    editor.selection = new vscode.Selection(position, position)
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport)
  }

  /** Close the tab, ending its review; a later review opens a new one. */
  close(): void {
    this.panel?.dispose()
  }

  /** Close the tab when the extension stops. */
  dispose(): void {
    this.close()
  }

  /** Open the tab with its static document and connect its messages. */
  private open(title: string): vscode.WebviewPanel {
    /* Listen before assigning the document, which reports ready as soon as its script runs. */
    const panel = vscode.window.createWebviewPanel('srmdReviewer', title, vscode.ViewColumn.Active, {
      enableScripts: true,
      // Keep the shown face and scroll position while the tab is in the background.
      retainContextWhenHidden: true
    })
    this.panel = panel
    this.card = null
    this.shown = null
    this.ready = false
    const receive = panel.webview.onDidReceiveMessage((message: ReviewerMessage) => {
      /* Send the current card once the document listens; accept only a choice it offered, for that card. */
      if (message?.type === 'ready') {
        this.ready = true
        if (this.card) void panel.webview.postMessage(this.card)
      } else if (message?.type === 'review' && message.id === this.card?.id && typeof message.choice_id === 'string') {
        const rating = review_rating(message.choice_id)
        if (rating !== null) this.settle?.({ type: 'rated', rating })
      }
    })
    panel.onDidDispose(() => {
      receive.dispose()
      if (this.panel !== panel) return
      this.panel = null
      this.settle?.({ type: 'closed' })
    })
    panel.webview.html = this.document(panel.webview)
    return panel
  }

  /** The tab's static document: content policy, stylesheets, an empty card container and the reviewer script. */
  private document(webview: vscode.Webview): string {
    /* Resolve the extension's media for the webview; the base starts at the workspace root and moves to each note's folder. */
    const media = (...parts: string[]): string => webview.asWebviewUri(vscode.Uri.joinPath(this.extension_uri, 'dist', ...parts)).toString(true)
    const base = webview.asWebviewUri(str_to_uri('')).toString() + '/'
    // No inline script: the display settings travel in a data attribute, so scripts need no nonce.
    const csp = `default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource}; script-src ${webview.cspSource}`
    return `<!doctype html>
<html lang="${getLocale()}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <base href="${escape_html(base)}" />
  <link rel="stylesheet" href="${media('media', 'reviewer.css')}" />
  <link rel="stylesheet" href="${media('media', 'reviewer-vscode.css')}" />
</head>
<body>
  <div id="review" data-config="${escape_html(JSON.stringify(this.config))}"></div>
  <script src="${media('reviewer.js')}"></script>
</body>
</html>
`
  }

  /** Select, display, rate and save cards from the current scope until it runs out or the tab closes. */
  private async run(panel: vscode.WebviewPanel): Promise<void> {
    /* Each iteration reads the scope anew, so a retarget needs no new loop. */
    while (this.panel === panel) {
      const scope = this.scope
      const card = await this.workspace.run(() => this.workspace.next_card(scope))
      if (this.panel !== panel) return
      // A retarget while the card was being prepared selects again from the new scope.
      if (scope !== this.scope) continue
      if (!card) {
        void vscode.window.showInformationMessage(m.vscode_no_more_cards())
        return
      }
      this.shown = card
      const result = await this.show(panel, card.data)
      if (result.type === 'skipped') continue
      if (result.type === 'closed') return
      if (!await this.workspace.run(() => this.rate(card, result.rating))) return
    }
  }

  /**
   * Save a rating through the workspace (see its rate()); false once a failed save has been reported. Runs as a task.
   * A rating dropped because the note changed after its card was shown is reported as a warning.
   */
  private async rate(card: PreparedCard, rating: ReviewRating): Promise<boolean> {
    /* Report a failed read or write of the note, which ends the review, or a dropped rating, after which it goes on. */
    const result = await this.workspace.rate(card, rating)
    if (result.status === 'failed') {
      const message = m.vscode_save_failed({ path: card.path, detail: error_text(result.error) })
      this.log.error(message)
      void vscode.window.showErrorMessage(message)
      return false
    }
    if (result.status === 'changed') {
      const message = m.vscode_note_changed({ path: card.path })
      this.log.warn(message)
      void vscode.window.showWarningMessage(message)
    }
    return true
  }

  /** Send a card to the tab and wait for its rating, for the tab to close, or for a retarget to skip the card. */
  private show(panel: vscode.WebviewPanel, data: ReviewData): Promise<CardResult> {
    /* Render the controls here, then send them with the note's folder as base for its relative resources. */
    const webview = panel.webview
    this.card = {
      type: 'card', id: this.next_id++,
      base: webview.asWebviewUri(vscode.Uri.joinPath(str_to_uri(data.path), '..')).toString() + '/',
      markup: compile_html('review-root', data.title, data.html, data.choices, 'good', this.config, data.notices),
      ordinal: data.card_ordinal
    }
    return new Promise<CardResult>(resolve => {
      this.settle = result => {
        this.settle = null
        resolve(result)
      }
      // Before the document is ready, its ready message sends this card instead.
      if (this.ready) void webview.postMessage(this.card)
    })
  }
}
