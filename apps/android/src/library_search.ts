/** The drawer's search of all files: which files match a query, by name or by text. */

/**
 * The files matching a query, each with its number of text matches. A file matches by name when its path contains
 * every whitespace-separated term of the query, and by text when its text contains the whole query; case is ignored
 * in both. A file matching only by name counts 0 text matches. Files without a text, such as images or texts not
 * read yet, match by name only. Matching the whole query in the text keeps the count equal to what the note search
 * highlights when the file opens with the query.
 * @param paths - Workspace-relative paths of the files to search.
 * @param text - The text of the file at a path, or undefined.
 */
export function search_files(query: string, paths: string[], text: (path: string) => string | undefined): { [path: string]: number } {
  /* Normalize the query once, then test each path's name and count its text matches. */
  const phrase = query.trim().toLowerCase()
  const terms = phrase.split(/\s+/).filter(Boolean)
  const matches: { [path: string]: number } = Object.create(null)
  if (!terms.length) return matches
  for (const path of paths) {
    const content = text(path)?.toLowerCase()
    let count = 0
    if (content) for (let index = content.indexOf(phrase); index !== -1; index = content.indexOf(phrase, index + phrase.length)) count++
    const lower = path.toLowerCase()
    if (count || terms.every(term => lower.includes(term))) matches[path] = count
  }
  return matches
}
