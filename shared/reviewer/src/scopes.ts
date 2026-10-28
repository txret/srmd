/** Choosing what to review: the notes and folders holding cards, found by a fuzzy search of their paths. */
import { FOLDER, get_counts, type Counts, type State } from '../../scheduler/src'

/** A note or folder holding cards, as offered for review. */
export interface ReviewScope {
  /** Workspace-relative path; the empty string is the open folder, which reviews the whole workspace. */
  path: string
  folder: boolean
  counts: Counts
  /** Whether the note, or a note below the folder, has problems to check before reviewing. */
  problems: boolean
}

/** Characters after which a path character starts a word: folder separators and separators in names. */
const separators = '/ ._-'

/**
 * List the notes and folders holding cards for choosing what to review. Without a query they come in display
 * order, the open folder first. Otherwise only those whose path contains every whitespace-separated term of the
 * query as a fuzzy match (see fuzzy_score()) remain, the best match first, then the shorter path, then display order.
 * @param root_name - The open folder's name, matched in place of the workspace's empty path.
 */
export function review_scopes(state: State, query: string, root_name: string): ReviewScope[] {
  /*
   * 1. Walk the tree depth-first in display order, keeping the nodes that hold cards.
   * 2. Without query terms, return them in that order.
   * 3. Otherwise score each path against every term, drop paths missing a term, and sort by score and length.
   */
  // Step 1: display order is each folder's children order, depth-first from the open folder.
  const scopes: ReviewScope[] = []
  const pending = state.nodes[''] ? [''] : []
  while (pending.length) {
    const node = state.nodes[pending.pop()!]
    const folder = node.type === FOLDER
    if (folder) pending.push(...[...node.children].reverse())
    if (folder ? !node.total : !node.cards.length) continue
    scopes.push({ path: node.path, folder, counts: get_counts(node), problems: folder ? node.problems > 0 : node.problems.length > 0 })
  }

  // Step 2: the whole list for an empty query.
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return scopes

  // Step 3: every term must match; a stable sort keeps display order among equal scores and lengths.
  const scored: { scope: ReviewScope; score: number; length: number }[] = []
  for (const scope of scopes) {
    const text = scope.path || root_name
    let score = 0
    for (const term of terms) {
      const term_score = fuzzy_score(term, text)
      if (term_score === null) {
        score = -1
        break
      }
      score += term_score
    }
    if (score >= 0) scored.push({ scope, score, length: text.length })
  }
  scored.sort((left, right) => right.score - left.score || left.length - right.length)
  return scored.map(entry => entry.scope)
}

/**
 * Score a path against one lowercase query term: null unless the term's characters occur in the path in order,
 * ignoring case. Each matched character scores 1, 2 more when it directly follows the previous match and 3 more
 * when it starts a word, so `tpa` finds `topic/a.sr.md`, and characters starting words or forming a run beat the
 * same characters scattered inside words.
 */
function fuzzy_score(term: string, path: string): number | null {
  /*
   * 1. Score the term as one run, preferring an occurrence that starts a word.
   * 2. Score the term's characters at their first occurrences in order, which finds scattered matches.
   * 3. Keep the better of the two; a term found as a run always matches in order, so only step 2 can fail.
   */
  const text = path.toLowerCase()
  /** Whether the character at index starts a word of the path. */
  const starts = (index: number): boolean => index === 0 || separators.includes(text[index - 1])

  // Step 1: a run scores as if every character after its first followed directly.
  let run = 0
  for (let index = text.indexOf(term); index !== -1; index = text.indexOf(term, index + 1)) {
    run = Math.max(run, term.length * 3 - 2 + (starts(index) ? 3 : 0))
    if (starts(index)) break
  }

  // Step 2: greedy in-order matching from the left.
  let scattered = 0
  let previous = -2
  for (const character of term) {
    const index = text.indexOf(character, previous + 1)
    if (index === -1) return null
    scattered += 1 + (index === previous + 1 ? 2 : 0) + (starts(index) ? 3 : 0)
    previous = index
  }
  return Math.max(run, scattered)
}
