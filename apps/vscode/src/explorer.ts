import * as vscode from 'vscode'
import { m } from '@srmd/l10n'
import { NOTE, get_counts, type State } from '@srmd/scheduler'
import { problem_text } from '@srmd/reviewer'
import { str_to_uri } from './filesystem'

/** Present scheduler counts on native Explorer resources, including collapsed folders. */
export class ExplorerProvider implements vscode.FileDecorationProvider, vscode.Disposable {
  /** Full URI keys prevent unrelated workspaces or URI schemes from sharing decorations. */
  private decorations: { [uri: string]: vscode.FileDecoration } = {}
  /** A full invalidation also removes decorations for deleted notes and pruned folders. */
  private readonly changed = new vscode.EventEmitter<undefined>()
  readonly onDidChangeFileDecorations = this.changed.event

  /** Read the host's existing state after its counts have been refreshed. */
  constructor(private readonly state: State) {}

  /**
   * Replace the Explorer snapshot and restrict Review to resources containing cards.
   * Notes with problems, and folders containing such notes, get a warning badge and color, with the
   * problems (or their number) below the counts in the tooltip, so they are noticed before a review.
   */
  async refresh(): Promise<void> {
    /* Convert note/folder counts and problems to decorations, publish menu membership, then invalidate cached badges. */
    const decorations: { [uri: string]: vscode.FileDecoration } = {}
    /** VS Code's `in` context operator checks these full resource URI keys. */
    const review_resources: { [uri: string]: boolean } = {}
    for (const node of Object.values(this.state.nodes)) {
      const total = node.type === NOTE ? node.cards.length : node.total
      const problems = node.type === NOTE ? node.problems.map(problem_text) : node.problems ? [m.vscode_folder_problems({ count: node.problems })] : []
      if (!total && !problems.length) continue
      const { due, new: fresh, later } = get_counts(node)
      const resource = str_to_uri(node.path).toString()
      const decoration: vscode.FileDecoration = {
        // Colored glyphs convey status without overriding Explorer's normal text colors.
        badge: problems.length ? '⚠' : due ? '🔴' : fresh ? '🔵' : '🟢',
        tooltip: [m.vscode_counts_long({ due, new: fresh, later }), ...problems].join('\n'),
        // Folder counts already include every descendant with due > new > future priority.
        // Native bubbling replaces text badges with a generic dot, so decorate each folder directly.
        propagate: false
      }
      // A problem is worth overriding the label color for, as VS Code does for files with warnings.
      if (problems.length) decoration.color = new vscode.ThemeColor('list.warningForeground')
      decorations[resource] = decoration
      if (total) review_resources[resource] = true
    }

    // Publish both surfaces from the same snapshot, including an empty workspace.
    this.decorations = decorations
    await vscode.commands.executeCommand('setContext', 'srmd.reviewResources', review_resources)
    this.changed.fire(undefined)
  }

  /** Return cached metadata for this exact URI without reading or parsing files. */
  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    /* Use full URI identity so files outside the loaded workspace remain undecorated. */
    return this.decorations[uri.toString()]
  }

  /** Release the event emitter when the extension stops. */
  dispose(): void {
    /* Registration is disposed by the host; release this provider's listeners and snapshot. */
    this.changed.dispose()
    this.decorations = {}
  }
}
