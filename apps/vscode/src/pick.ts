import * as vscode from 'vscode'
import { m } from '@srmd/l10n'
import { review_scopes, type ReviewScope } from '@srmd/reviewer'
import type { State } from '@srmd/scheduler'

/** A quick pick row and the scope it reviews. */
interface ScopeItem extends vscode.QuickPickItem {
  path: string
}

/**
 * Ask which note or folder to review: a quick pick of those holding cards with their counts, narrowed by a fuzzy
 * search of their paths as the user types (see review_scopes()).
 * @param root_name - The open folder's name, which labels the row reviewing the whole workspace.
 * @returns The chosen workspace-relative path, or undefined when the pick is dismissed.
 */
export function pick_scope(state: State, root_name: string): Promise<string | undefined> {
  /*
   * 1. Create the pick with every scope, and refill it with the matches whenever the typed value changes.
   * 2. Resolve with the accepted row's path, or with undefined once the pick hides without one.
   */
  const pick = vscode.window.createQuickPick<ScopeItem>()
  pick.placeholder = m.vscode_pick_scope()
  /** Replace the rows with the scopes matching the typed value, best first. */
  const fill = (): void => {
    pick.items = review_scopes(state, pick.value, root_name).map(scope => item(scope, root_name))
  }
  pick.onDidChangeValue(fill)
  fill()
  return new Promise(resolve => {
    pick.onDidAccept(() => {
      resolve(pick.selectedItems[0]?.path)
      pick.hide()
    })
    pick.onDidHide(() => {
      resolve(undefined)
      pick.dispose()
    })
    pick.show()
  })
}

/**
 * A scope's row: an icon and its path (the open folder by name) with the Flashcards view's counts. VS Code's own
 * label filter matches only runs of the label, so it would hide rows the fuzzy search keeps; alwaysShow leaves
 * filtering to the search. VS Code still lists the rows it matches first, highlighted.
 */
function item(scope: ReviewScope, root_name: string): ScopeItem {
  const icon = !scope.path ? '$(root-folder)' : scope.folder ? '$(folder)' : '$(file)'
  return {
    label: `${icon} ${scope.path || root_name}`,
    description: (scope.problems ? '⚠ ' : '') + m.vscode_counts_short(scope.counts),
    path: scope.path,
    alwaysShow: true
  }
}
