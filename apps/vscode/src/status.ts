import * as vscode from 'vscode'
import { m } from '@srmd/l10n'

/** Status bar command: turn srmd on when it is off, off when it is on. */
export const TOGGLE_COMMAND = 'srmd.toggle'

/** The status bar item showing whether srmd is on in this workspace; clicking it turns srmd on or off. */
export class StatusItem implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem('srmd.status', vscode.StatusBarAlignment.Right, 100)

  /** Create the item hidden; update() shows it. */
  constructor() {
    // The name identifies the item in the status bar's context menu, where users can hide it.
    this.item.name = 'srmd'
    this.item.command = TOGGLE_COMMAND
  }

  /** Show the current state, or hide the item while no folder is open, since there is nothing to turn on. */
  update(enabled: boolean): void {
    /* Mark the state by icon, explain the click in the tooltip, then show the item only with a folder. */
    this.item.text = enabled ? '$(mortar-board) srmd' : '$(circle-slash) srmd'
    this.item.tooltip = enabled ? m.vscode_status_on() : m.vscode_status_off()
    if (vscode.workspace.workspaceFolders?.length) this.item.show()
    else this.item.hide()
  }

  /** Remove the item when the extension stops. */
  dispose(): void {
    this.item.dispose()
  }
}
