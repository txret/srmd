/** Choosing what to review: the notes and folders holding cards. */
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

/**
 * List the notes and folders holding cards for choosing what to review, in display order, the open folder first:
 * depth first, each folder's children in their order.
 */
export function review_scopes(state: State): ReviewScope[] {
  /* Walk the tree from the open folder, children pushed in reverse so they are taken in order. */
  const scopes: ReviewScope[] = []
  const pending = state.nodes[''] ? [''] : []
  while (pending.length) {
    const node = state.nodes[pending.pop()!]
    const folder = node.type === FOLDER
    if (folder) pending.push(...[...node.children].reverse())
    if (folder ? !node.total : !node.cards.length) continue
    scopes.push({ path: node.path, folder, counts: get_counts(node), problems: folder ? node.problems > 0 : node.problems.length > 0 })
  }
  return scopes
}
