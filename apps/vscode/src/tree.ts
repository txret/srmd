import * as vscode from 'vscode'
import { m } from '@srmd/l10n'
import { FOLDER, NOTE, get_counts, get_name, get_parent, type Folder, type Note, type State } from '@srmd/scheduler'
import { str_to_uri, workspace_path } from './filesystem'

/**
 * The Flashcards view (`srmd.notes`) in the Explorer: the open folder, its notes and folders with their counts. Rows carry no command, so
 * browsing never opens a note and shows its answers: Review and Edit are row buttons, menu items and keys.
 */
export class NoteTree implements vscode.TreeDataProvider<Note | Folder>, vscode.Disposable {
  /** A full invalidation also removes rows for deleted notes and pruned folders. */
  private readonly changed = new vscode.EventEmitter<undefined>()
  readonly onDidChangeTreeData = this.changed.event
  /** The view: commands run from the keyboard act on its selection, and it selects the note being edited. */
  private readonly view: vscode.TreeView<Note | Folder>
  /** The view and the listeners that keep its selection on the active editor's note. */
  private readonly subscriptions: vscode.Disposable[]

  /** Show the host's state, read after each recount. */
  constructor(private readonly state: State) {
    this.view = vscode.window.createTreeView('srmd.notes', { treeDataProvider: this })
    this.subscriptions = [
      this.view,
      vscode.window.onDidChangeActiveTextEditor(() => this.follow()),
      this.view.onDidChangeVisibility(() => this.follow())
    ]
  }

  /** Ask VS Code to request every visible row again after the host recounts. */
  refresh(): void {
    this.changed.fire(undefined)
  }

  /** List a folder's subfolders and notes; the top level holds only the open folder, so the whole workspace can be reviewed. */
  getChildren(folder?: Folder): (Note | Folder)[] {
    /* Return the root row at the top level. Otherwise look the folder up again by path; its children are kept in display order. */
    const root = this.state.nodes['']
    if (!folder) return root ? [root] : []
    // VS Code can still hold a folder from before a workspace reload, so use the current node at that path.
    const parent = this.state.nodes[folder.path]
    if (parent?.type !== FOLDER) return []
    return parent.children.map(path => this.state.nodes[path])
  }

  /** The folder holding a row, which VS Code needs to reveal it; the open folder's row has none. */
  getParent(node: Note | Folder): Folder | undefined {
    const parent = get_parent(node.path)
    return parent === null ? undefined : this.state.nodes[parent] as Folder
  }

  /**
   * Present a note or folder with its counts. Rows use their URI as id, which survives refreshes and stays non-empty
   * for the root, whose relative path is the empty string; VS Code treats an empty id as missing.
   */
  getTreeItem(node: Note | Folder): vscode.TreeItem {
    /* Name the row (the root by its workspace folder), let its URI select themed icons, show the counts and tag its menus. */
    const is_note = node.type === NOTE
    const label = node.path ? get_name(node.path) : vscode.workspace.workspaceFolders?.[0]?.name ?? ''
    const collapsible = is_note ? vscode.TreeItemCollapsibleState.None
      : node.path ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded
    const item = new vscode.TreeItem(label, collapsible)
    item.resourceUri = str_to_uri(node.path)
    item.id = item.resourceUri.toString()
    item.iconPath = is_note ? vscode.ThemeIcon.File : vscode.ThemeIcon.Folder
    const counts = get_counts(node)
    // Abbreviate the inline counts to keep rows narrow; the tooltip spells them out below the default path.
    // A warning sign marks a note with problems, or a folder containing one; the tooltip lists them.
    const problems = is_note ? node.problems.length : node.problems
    item.description = (problems ? '⚠ ' : '') + m.workspace_counts(counts)
    // No row tooltip: rows carry their resource URI, so VS Code applies the Explorer's file decoration to them too,
    // including its tooltip with the full counts (see ExplorerProvider).
    // The manifest's row buttons and menu items select on this: Review for every row, Edit for notes only.
    item.contextValue = is_note ? 'note' : 'folder'
    return item
  }

  /** The row a command acts on: the one whose button or menu item ran it, otherwise the selected row (keyboard). */
  row(node?: Note | Folder): Note | Folder | undefined {
    return node ?? this.view.selection[0]
  }

  /** Select the active editor's note, without taking focus, while the view is visible; other editors change nothing. */
  private follow(): void {
    /* Map the editor's resource to a loaded note; folders are never selected this way. */
    const uri = vscode.window.activeTextEditor?.document.uri
    if (!this.view.visible || !uri) return
    const path = workspace_path(uri)
    const node = path === null ? undefined : this.state.nodes[path]
    if (node?.type === NOTE) void this.view.reveal(node, { select: true, focus: false, expand: true })
  }

  /** Release the view, its listeners and the event emitter when the extension stops. */
  dispose(): void {
    for (const subscription of this.subscriptions) subscription.dispose()
    this.changed.dispose()
  }
}
