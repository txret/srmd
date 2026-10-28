import type { DefinitionProblem, Scheduling } from '../../parser/src'
import { day_diff, parse_date, review_day } from './dates'
import { SchedulerConfig } from './types'

export const NOTE = 1
export const FOLDER = 3

/** Stored fields plus the group's one-based position, independent of its persisted ref. */
export interface Card extends Scheduling {
  ordinal: number
}

/**
 * Something the user should check before reviewing a note, because reviewing or saving it could lose information.
 * - invalid_date: a date outside the calendar, found by create_note(). The card is kept as written and left
 *   out of every queue.
 * - unmatched_definition, duplicate_definition: from the parse; a save removes the definition.
 */
export type NoteProblem =
  | { kind: 'invalid_date'; ordinal: number; field: 'due' | 'last_review'; value: string }
  | DefinitionProblem

/** Notes and folders by workspace-relative path. */
export type Nodes = { [path: string]: Note | Folder }

/**
 * An empty node dictionary without a prototype: folder names such as `constructor`, `toString` or
 * `__proto__` are ordinary paths and must not find inherited Object members.
 */
export function empty_nodes(): Nodes {
  return Object.create(null) as Nodes
}

/** Portable queue state. Hosts may extend it without adding platform services here. */
export class State {
  root: string | null = null
  /** Notes and ancestor folders, indexed by workspace-relative slash-separated paths. */
  nodes: Nodes = empty_nodes()
  /** Time of the last count, used to rebuild queues only across review-day boundaries. */
  last_recount: number | null = null

  /** Create an empty workspace with scheduler-only settings. */
  constructor(public config: SchedulerConfig = new SchedulerConfig()) {}

  /** Whether note queues must be rebuilt for a new local review day. */
  has_rolled_over(now: number = Date.now()): boolean {
    /* Compare calendar review days, including when the local clock moves backwards. */
    return this.last_recount === null || day_diff(new Date(now), new Date(this.last_recount), this.config.rollover) !== 0
  }

  /** Refresh due counts, rebuilding note queues only when the review day changes. */
  recount(now: number = Date.now()): void {
    /* Update note queues/counts, collect folders by depth, then aggregate from leaves to root. */
    const rebuild = this.has_rolled_over(now)
    const date = new Date(now)
    /** Depth buckets let parent counts use already refreshed children without recursion. */
    const folders: Folder[][] = []
    for (const [path, node] of Object.entries(this.nodes)) {
      if (node.type === NOTE) {
        if (rebuild) node.requeue(date)
        let due = 0
        while (due < node.intraday.length && parse_date(node.intraday[due].due)!.getTime() <= now) due++
        node.intraday_due = due
      } else {
        const depth = path ? path.split('/').length : 0
        if (!folders[depth]) folders[depth] = []
        folders[depth].push(node)
      }
    }

    // Count every child folder before its parent, including the workspace root.
    for (let depth = folders.length - 1; depth >= 0; depth--) {
      for (const folder of folders[depth] ?? []) {
        folder.total = folder.new = folder.interday = folder.intraday_due = folder.problems = 0
        for (const path of folder.children) {
          const child = this.nodes[path]
          folder.total += child.type === NOTE ? child.cards.length : child.total
          folder.new += child.type === NOTE ? child.new.length : child.new
          folder.interday += child.type === NOTE ? child.interday.length : child.interday
          folder.intraday_due += child.intraday_due
          folder.problems += child.type === NOTE ? Number(child.problems.length > 0) : child.problems
        }
      }
    }
    this.last_recount = now
  }
}

/** A note's cards and daily queues; source text and file versions stay with the host. */
export class Note {
  readonly type = NOTE
  intraday: Card[] = []
  intraday_due = 0
  interday: Card[] = []
  new: Card[] = []
  /**
   * The note text the cards were parsed from, set by the host. Before saving a review the host compares it
   * with the file, so a save never overwrites edits the cards do not reflect.
   */
  version = ''

  /**
   * Queue cards copied and prepared by the scheduler, in cloze group order.
   * problems lists what the user should check before reviewing; cards with an invalid date are not queued.
   * Hosts may add problems of the parse; only invalid dates affect the queues.
   */
  constructor(private state: State, public path: string, public cards: Card[], now: Date = new Date(), public problems: NoteProblem[] = []) {
    /* Build today's queues without touching the parser's scheduling snapshot. */
    this.requeue(now)
  }

  /** Rebuild queues after a review or a local review-day change. */
  requeue(now: Date = new Date()): void {
    /*
     * Partition new, interday and intraday cards by the review day of their due date against today's, which is
     * computed once, when the first reviewed card needs it; a last review is decoded only for a card due today. Only
     * intraday cards need due-time ordering.
     */
    const rollover = this.state.config.rollover
    /** Today's review day; none until a card with a due date asks, so notes of new cards compute no date at all. */
    let today: number | undefined
    const intraday: Card[] = []
    const interday: Card[] = []
    const new_cards: Card[] = []
    // A card with a date outside the calendar cannot be scheduled; it waits until the note is fixed.
    const blocked = new Set(this.problems.flatMap(problem => problem.kind === 'invalid_date' ? [problem.ordinal] : []))
    for (const card of this.cards) {
      if (blocked.has(card.ordinal)) continue
      if (card.state === 'n') {
        new_cards.push(card)
        continue
      }
      // A card without a due date is overdue.
      const due = parse_date(card.due)
      const days = due ? review_day(due, rollover) - (today ??= review_day(now, rollover)) : -1
      if (days < 0) interday.push(card)
      else if (days === 0) {
        const last_review = parse_date(card.last_review)
        if (last_review && review_day(last_review, rollover) === today) intraday.push(card)
        else interday.push(card)
      }
    }
    // Fixed-width local timestamps sort in the same order as their decoded dates.
    this.intraday = intraday.sort((a, b) => a.due.localeCompare(b.due))
    this.interday = interday
    this.new = new_cards
  }
}

/** Folder relationships and counts, kept separate from note card arrays. */
export class Folder {
  readonly type = FOLDER
  /** All descendant cards, including future cards absent from today's queues. */
  total = 0
  /** Intraday cards whose exact due time has passed, as Note.intraday_due counts them. */
  intraday_due = 0
  /** Notes with problems below this folder, so collapsed folders can show a warning. */
  problems = 0
  interday = 0
  new = 0

  /** Create an empty folder or supply its immediate child paths. */
  constructor(public path: string, public children: string[] = []) {}
}

/** Card counts presented for one note or folder; folder counts include every descendant note. */
export type Counts = {
  /** Interday cards plus intraday cards whose exact due time had passed at the last recount. */
  due: number
  /** Cards never reviewed. */
  new: number
  /** Reviewed cards not due yet: intraday cards due later today and cards due on future review days. */
  later: number
}

/** Read a note's or folder's counts as of the last recount(), without scanning its cards. */
export function get_counts(node: Note | Folder): Counts {
  /* Notes count their queues and folders use their aggregates; every card neither due nor new is later. */
  const due = node.type === NOTE ? node.interday.length + node.intraday_due : node.interday + node.intraday_due
  const fresh = node.type === NOTE ? node.new.length : node.new
  const total = node.type === NOTE ? node.cards.length : node.total
  return { due, new: fresh, later: total - due - fresh }
}

/** Parent of a workspace-relative path; the root's parent is null. */
export function get_parent(path: string): string | null {
  /* Strip the last segment, preserving the empty string used for the workspace root. */
  if (!path) return null
  const index = path.lastIndexOf('/')
  return index === -1 ? '' : path.slice(0, index)
}

/** Last segment of a slash-separated workspace-relative path. */
export function get_name(path: string): string {
  /* Extract the leaf name without depending on a host filesystem library. */
  return path.slice(path.lastIndexOf('/') + 1)
}
