import * as vscode from 'vscode'

/** Convert a workspace resource to the scheduler's relative path, using an empty root path. */
export const uri_to_str = (uri: vscode.Uri): string => {
  /* VS Code returns the absolute path for the workspace root, which needs explicit normalization. */
  if (uri.toString() === vscode.workspace.workspaceFolders?.[0]?.uri.toString()) return ''
  return vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/')
}

/** Convert the scheduler's workspace-relative path back to a resource URI; the empty path is the root. */
export const str_to_uri = (str: string): vscode.Uri => {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.parse('file:///')
  return vscode.Uri.joinPath(root, ...str.split('/'))
}

/**
 * The workspace-relative path of a resource in the open folder, or null for any other resource, such as one
 * outside the folder whose relative path still looks like a note's.
 */
export const workspace_path = (uri: vscode.Uri): string | null => {
  const path = uri_to_str(uri)
  return str_to_uri(path).toString() === uri.toString() ? path : null
}

/** Read a workspace file as UTF-8 text. */
export async function read_file(path: string): Promise<string> {
  const data = await vscode.workspace.fs.readFile(str_to_uri(path))
  return new TextDecoder('utf-8').decode(data)
}

/** Write UTF-8 text to a workspace file, creating or replacing it. */
export async function write_file(path: string, text: string): Promise<void> {
  const data = new TextEncoder().encode(text)
  await vscode.workspace.fs.writeFile(str_to_uri(path), data)
}

/**
 * Whether a workspace path is a folder, and its modification time; null only when the path does not exist,
 * including below a folder that a file replaced.
 */
export async function stat_path(path: string): Promise<{ folder: boolean; mtime: number } | null> {
  /* A symbolic link reports its target's type bit as well, so test the folder bit rather than equality. */
  try {
    const stat = await vscode.workspace.fs.stat(str_to_uri(path))
    return { folder: (stat.type & vscode.FileType.Directory) !== 0, mtime: stat.mtime }
  } catch (error: unknown) {
    // Other failures, such as denied access, say nothing about whether the path still exists.
    if (error instanceof vscode.FileSystemError && (error.code === 'FileNotFound' || error.code === 'FileNotADirectory')) return null
    throw error
  }
}

/** Workspace-relative paths of the files under folder that match a glob pattern. */
export async function find_files(folder: vscode.Uri, pattern: string): Promise<string[]> {
  const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, pattern))
  return files.map(uri_to_str)
}
