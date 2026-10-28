/** Every file of the workspace folder as a tree, the notes with their counts: for hosts that list more than notes. */
import { FOLDER, NOTE, compare_siblings, get_counts, get_name, get_parent, type Counts, type State } from '../../scheduler/src'

/** A file of the workspace folder, as a host's listing reports it. */
export interface FileEntry {
  /** Workspace-relative, slash-separated path. */
  path: string
  /** Modification time in milliseconds since the epoch; with size, it tells whether a copy of the text is current. */
  mtime: number
  /** Size in bytes. */
  size: number
}

/**
 * What a file is to a host: a note (a configured suffix), other Markdown, plain text, or anything else, which hosts
 * hand to other apps.
 */
export type FileKind = 'note' | 'markdown' | 'text' | 'other'

/** File name extensions, lowercase with their dot (`.md`), of the files a host opens as Markdown or as plain text. */
export interface FileTypes {
  markdown: string[]
  text: string[]
}

/** The kind of the file at path; a note suffix decides first, as it may end in a Markdown extension (`.sr.md`). */
export function file_kind(path: string, suffixes: string[], types: FileTypes): FileKind {
  /* Compare suffixes as written, extensions ignoring case. */
  if (suffixes.some(suffix => path.endsWith(suffix))) return 'note'
  const name = get_name(path).toLowerCase()
  const dot = name.lastIndexOf('.')
  // A name starting with its only dot, such as `.profile`, has no extension.
  const extension = dot > 0 ? name.slice(dot) : ''
  if (types.markdown.includes(extension)) return 'markdown'
  if (types.text.includes(extension)) return 'text'
  return 'other'
}

/** One visible row of the file tree. */
export interface TreeRow {
  /** Workspace-relative path; the empty string is the workspace folder. */
  path: string
  /** The file or folder name; the workspace folder's row carries the name the host gave it. */
  name: string
  /** Nesting level: 0 for the workspace folder, 1 for its children. */
  depth: number
  kind: 'folder' | FileKind
  /** Whether a folder's children follow as rows; false for files. */
  expanded: boolean
  /** Due, new and later counts of a loaded note, or of every note below a folder; absent where there are no notes. */
  counts?: Counts
  /** Whether the note, or a note below the folder, has problems to check before reviewing. */
  problems: boolean
  /** The number of text matches of a search, for a file matching in its text; absent otherwise. */
  matches?: number
}

/** A folder's child files and folders, in display order, by folder path. */
type Children = { [folder: string]: { path: string; folder: boolean }[] }

/**
 * The folder structure of a file listing: each folder's children in display order (folders first, then names ignoring
 * case and comparing numbers by value, as the scheduler orders notes). Folders exist where files lie below them, so an
 * empty folder has no entry. Build it once per listing; tree_rows() takes it.
 */
export function folder_children(files: FileEntry[]): Children {
  /*
   * 1. Link every file into its parent folder, creating each ancestor folder once on the way up.
   * 2. Sort each folder's children into display order.
   */
  const children: Children = Object.create(null)
  children[''] = []
  for (const file of files) {
    let child = { path: file.path, folder: false }
    for (let parent = get_parent(child.path); parent !== null; parent = get_parent(parent)) {
      // An existing folder already links its own ancestors.
      const known = parent in children
      if (!known) children[parent] = []
      children[parent].push(child)
      if (known) break
      child = { path: parent, folder: true }
    }
  }
  for (const list of Object.values(children)) list.sort(compare_siblings)
  return children
}

/**
 * The visible rows of the file tree: the workspace folder, then the children of each expanded folder, depth first in
 * display order. Notes and folders take their counts from state; a note that did not load has none.
 * With matches, a search's result: only the matching files and their ancestor folders, every folder expanded.
 * @param root_name - The name shown for the workspace folder.
 * @param kinds - The kind of each file (see file_kind()).
 * @param expanded - Folder paths whose children show; the workspace folder always shows its children.
 * @param matches - For a search: matching file paths, each with its number of text matches (0 for a name match).
 */
export function tree_rows(
  state: State, children: Children, root_name: string, kinds: (path: string) => FileKind,
  expanded: { [path: string]: boolean }, matches?: { [path: string]: number }
): TreeRow[] {
  /*
   * 1. With matches, collect the folders on the way to a match, which are the only folders shown, all expanded.
   * 2. Walk the folders depth first from the workspace folder, emitting a row per shown child.
   */
  // Step 1: a folder shows in a search when a matching file lies below it.
  let shown_folders: { [path: string]: true } | null = null
  if (matches) {
    shown_folders = Object.create(null) as { [path: string]: true }
    for (const path of Object.keys(matches)) {
      for (let parent = get_parent(path); parent !== null; parent = get_parent(parent)) shown_folders[parent] = true
    }
  }

  // Step 2: rows in display order; a stack of folders whose children are still to emit, depth first.
  const rows: TreeRow[] = []
  /** Push the row of a note, file or folder at path. */
  const push = (path: string, folder: boolean, depth: number): boolean => {
    /* Folders and notes carry the scheduler's counts; other files only their search matches. */
    const node = state.nodes[path]
    const kind = folder ? 'folder' : kinds(path)
    const open = folder && (shown_folders ? true : path === '' || expanded[path] === true)
    const row: TreeRow = { path, name: path ? get_name(path) : root_name, depth, kind, expanded: open, problems: false }
    if (node && (node.type === FOLDER) === folder) {
      row.counts = get_counts(node)
      row.problems = node.type === NOTE ? node.problems.length > 0 : node.problems > 0
    }
    if (matches && !folder) row.matches = matches[path]
    rows.push(row)
    return open
  }
  /** Emit the shown children of the folder at path, and below each expanded child folder its own. */
  const walk = (path: string, depth: number): void => {
    for (const child of children[path] ?? []) {
      if (shown_folders && !(child.folder ? shown_folders[child.path] : child.path in matches!)) continue
      if (push(child.path, child.folder, depth)) walk(child.path, depth + 1)
    }
  }
  if (push('', true, 0)) walk('', 1)
  return rows
}
