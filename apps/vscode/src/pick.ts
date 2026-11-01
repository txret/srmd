import * as vscode from 'vscode'
import { m } from '@srmd/l10n'
import { review_scopes, type ReviewScope } from '@srmd/reviewer'
import type { State } from '@srmd/scheduler'

/** A quick pick row and the scope it reviews. */
interface ScopeItem extends vscode.QuickPickItem {
  path: string
}

/**
 * Ask which note or folder to review: a quick pick of those holding cards with their counts, in display order, which
 * VS Code narrows to the rows whose label matches what the user types.
 * @param root_name - The open folder's name, which labels the row reviewing the whole workspace.
 * @returns The chosen workspace-relative path, or undefined when the pick is dismissed.
 */
export async function pick_scope(state: State, root_name: string): Promise<string | undefined> {
  const items = review_scopes(state).map(scope => item(scope, root_name))
  return (await vscode.window.showQuickPick(items, { placeHolder: m.vscode_pick_scope() }))?.path
}

/** A scope's row: an icon and its path (the open folder by name) with the Flashcards view's counts. */
function item(scope: ReviewScope, root_name: string): ScopeItem {
  const icon = !scope.path ? '$(root-folder)' : scope.folder ? '$(folder)' : '$(file)'
  return {
    label: `${icon} ${scope.path || root_name}`,
    description: (scope.problems ? '⚠ ' : '') + m.workspace_counts(scope.counts),
    path: scope.path
  }
}
