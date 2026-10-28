import * as vscode from 'vscode'
import { m, set_language } from '@srmd/l10n'
import { NOTE, type Folder, type Note } from '@srmd/scheduler'
import { ui_labels, UIConfig } from '@srmd/ui'
import { str_to_uri, workspace_path } from './filesystem'
import { ExplorerProvider } from './explorer'
import { NoteFormatter } from './formatter'
import { NoteTree } from './tree'
import { pick_scope } from './pick'
import { extend_markdown_it, type MarkdownIt } from './preview'
import { ReviewPanel } from './review_panel'
import { formatting_only, read_settings, write_enabled, type Settings } from './settings'
import { StatusItem, TOGGLE_COMMAND } from './status'
import { Workspace } from './workspace'

/** What activation exports: VS Code's Markdown preview passes its markdown-it instance to extendMarkdownIt(). */
export interface Api {
  extendMarkdownIt<T extends MarkdownIt>(md: T): T
}

/**
 * Compose the workspace, its views and the review tab, then load the open folder if srmd is on.
 * Off, which is the default, activation only shows the status bar item that turns it on.
 */
export async function activate(context: vscode.ExtensionContext): Promise<Api> {
  /*
   * 1. Select the message language, open the log and read the settings; setting changes are applied as they happen.
   * 2. Create the workspace, which publishes its counts to the Flashcards view and the native Explorer.
   * 3. Register views, row, review tab and on/off commands, the notes' formatter, setting and workspace changes, load
   *    the folder, then offer Review.
   * 4. Export the Markdown preview plugin, which reads the settings last applied.
   */
  // VS Code restarts extensions when its display language changes, so selecting it once suffices.
  set_language(vscode.env.language)
  const log = vscode.window.createOutputChannel('srmd', { log: true })
  context.subscriptions.push(log)
  /** The settings last applied; the toggle command turns srmd to the opposite of their enabled state. */
  let settings = read_settings(log)
  const config = new UIConfig(ui_labels())
  config.inactive = settings.inactive
  const status = new StatusItem()
  status.update(settings.enabled)

  const workspace = new Workspace(settings, log, async () => {
    tree.refresh()
    await explorer.refresh()
  })
  const explorer = new ExplorerProvider(workspace.state)
  const panel = new ReviewPanel(context.extensionUri, workspace, config, log)
  // Register the view before loading so it shows an empty tree rather than a missing data provider.
  const tree = new NoteTree(workspace.state)
  const formatter = new NoteFormatter(() => settings, log)
  formatter.update()
  /** Apply settings read anew: the status bar shows the state, and turning srmd off ends a review in progress. */
  const apply = (changed: Settings): void => {
    /*
     * Update display settings, the status and the formatted suffixes, close or redraw an open tab, redraw Markdown
     * previews, then load or unload the folder.
     */
    settings = changed
    config.inactive = changed.inactive
    status.update(changed.enabled)
    formatter.update()
    if (changed.enabled) panel.reload()
    else panel.close()
    // Previews render notes with the settings of their last update. The command is missing only while VS Code's
    // Markdown extension is disabled, and then there is no preview to redraw.
    vscode.commands.executeCommand('markdown.preview.refresh').then(undefined, () => undefined)
    void workspace.reconfigure(changed)
  }
  /** Turn srmd on or off in the workspace settings; the configuration change applies it. */
  const turn = async (enabled: boolean): Promise<void> => {
    if (!await write_enabled(enabled)) void vscode.window.showInformationMessage(m.vscode_open_folder_first())
  }
  context.subscriptions.push(
    workspace, panel, status,
    vscode.window.registerFileDecorationProvider(explorer), explorer,
    tree, formatter,
    // Row buttons and menu items pass their row; Enter and Ctrl+Enter pass nothing, so the selected row is used.
    vscode.commands.registerCommand('srmd.notes.review', (node?: Note | Folder) => {
      const row = tree.row(node)
      if (row) return panel.review(row.path)
    }),
    vscode.commands.registerCommand('srmd.notes.edit', (node?: Note | Folder) => {
      const row = tree.row(node)
      if (row?.type === NOTE) return vscode.window.showTextDocument(str_to_uri(row.path), { viewColumn: vscode.ViewColumn.Active, preview: false })
    }),
    vscode.commands.registerCommand('srmd.notes.reveal', (node?: Note | Folder) => {
      const row = tree.row(node)
      if (row) return vscode.commands.executeCommand('revealInExplorer', str_to_uri(row.path))
    }),
    vscode.commands.registerCommand('srmd.showNote', () => panel.show_note()),
    vscode.commands.registerCommand('srmd.enable', () => turn(true)),
    vscode.commands.registerCommand('srmd.disable', () => turn(false)),
    vscode.commands.registerCommand(TOGGLE_COMMAND, () => turn(!settings.enabled)),
    // Settings are read for the first folder, so a different folder can bring different settings.
    vscode.workspace.onDidChangeWorkspaceFolders(() => apply(read_settings(log))),
    vscode.workspace.onDidChangeConfiguration(event => {
      // Formatting settings apply at the next format, so changing only them reloads nothing.
      if (formatting_only(event)) settings = read_settings(log)
      else if (event.affectsConfiguration('srmd')) apply(read_settings(log))
    })
  )
  // Keep activation pending until notes, counts and Review are ready.
  await workspace.load()
  context.subscriptions.push(vscode.commands.registerCommand('srmd.review', async (scope?: string | vscode.Uri) => {
    /* Accept the Explorer menu's URI or a URI string; without one, as from the Command Palette, ask what to review. */
    if (scope === undefined) {
      const picked = await pick_scope(workspace.state, vscode.workspace.workspaceFolders?.[0]?.name ?? '')
      if (picked !== undefined) await panel.review(picked)
      return
    }
    // Reject resources outside the loaded workspace, even with a matching relative path.
    const path = workspace_path(typeof scope === 'string' ? vscode.Uri.parse(scope) : scope)
    if (path === null || !workspace.state.nodes[path]) return
    return panel.review(path)
  }))
  return { extendMarkdownIt: md => extend_markdown_it(md, () => settings) }
}

/** VS Code disposes the registered subscriptions on deactivation. */
export function deactivate(): void { }
