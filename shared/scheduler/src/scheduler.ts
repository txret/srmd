import { fsrs, Rating, type Grade } from 'ts-fsrs'
import type { Scheduling } from '../../parser/src'
// The card module alone, without the parser's markdown-it.
import { is_hint } from '../../parser/src/cards'
import { apply_fsrs, pick_due_day, set_due_in, to_fsrs } from './cards'
import { add_review_days, is_valid_date, parse_date, serialize_date } from './dates'
import { State, Note, Folder, empty_nodes, get_name, get_parent, FOLDER, NOTE, type Card, type NoteProblem } from './state'

export { Rating } from 'ts-fsrs'
/** An FSRS grade (Again, Hard, Good or Easy) or a fixed-interval choice. */
export type ReviewRating = Grade | 'tomorrow' | 'soon' | 'later'
/** A previewed interval: whole review days, or minutes for a learning step. Hosts format it in the user's language. */
export type Interval = { unit: 'days' | 'minutes'; count: number }
export type ReviewIntervals = { again: Interval; hard: Interval; good: Interval; easy: Interval }

/** Longest manual hint in days, about a century: later dates would leave the 14-digit timestamp format's years. */
export const MAX_HINT_DAYS = 36500

/** Explorer-style name order: case-insensitive, with numeric segments compared by value ("9" before "10"). */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * Display order of two sibling paths: folders before files, then by name. Reviews serve notes in this order, and hosts
 * listing other files beside notes sort them the same way. Names the collator treats as equal (`Folder` and
 * `folder`, `folder1` and `folder01`) are distinct paths, so the exact path decides last: only identical paths
 * compare equal.
 */
export function compare_siblings(a: { path: string; folder: boolean }, b: { path: string; folder: boolean }): number {
  return Number(b.folder) - Number(a.folder) || collator.compare(get_name(a.path), get_name(b.path)) ||
    (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
}

/** A note or folder as compare_siblings() takes it. */
const sibling = (node: Note | Folder): { path: string; folder: boolean } => ({ path: node.path, folder: node.type === FOLDER })

/** Scheduling and queue operations over portable state; no parsing, filesystem or UI services. */
export class Scheduler {
  /** One FSRS instance per scheduler, used for both previews and committed reviews. */
  private fsrs = fsrs()

  /** Use supplied state (including host subclasses), or start with an empty workspace. */
  constructor(public state: State = new State()) {}

  /** Reset the workspace to an empty root folder, or to no workspace; insert notes with update(). */
  load(root: string | null): void {
    /* Clear old queues and relationships, then create the root unless no workspace is open. */
    this.state.last_recount = null
    this.state.root = root
    this.state.nodes = empty_nodes()
    if (root !== null) this.state.nodes[''] = new Folder('')
  }

  /**
   * Copy parsed records into a queued note, resolving manual hints without changing the parse. A hint sets only the
   * state, `k`, and the due date, which persist_hints() saves; FSRS initializes memory at the first real review.
   * Dates outside the calendar become problems of the note; their cards are kept as written but not queued.
   * The caller inserts the result with update().
   * Other notes are consulted only for ! hints; the old version of path is excluded.
   * random must return a value in [0, 1) and is injectable for deterministic scheduling.
   */
  create_note(path: string, scheduling: readonly Scheduling[], now: Date = new Date(), random: () => number = Math.random): { note: Note; scheduling_changed: boolean } {
    /*
     * Copy the group-ordered records in one pass, which also collects the hints and checks the dates; a hint's due
     * date is replaced below, so only its last review is checked. Then resolve the hints in order and build the note's
     * daily queues.
     */
    const cards: Card[] = []
    const hints: Card[] = []
    const problems: NoteProblem[] = []
    for (let index = 0; index < scheduling.length; index++) {
      const card = { ...scheduling[index], ordinal: index + 1 }
      cards.push(card)
      if (is_hint(card.state)) hints.push(card)
      else if (!is_valid_date(card.due)) problems.push({ kind: 'invalid_date', ordinal: card.ordinal, field: 'due', value: card.due })
      if (!is_valid_date(card.last_review)) {
        problems.push({ kind: 'invalid_date', ordinal: card.ordinal, field: 'last_review', value: card.last_review })
      }
    }
    // Earlier hints update these same objects, so later hints see their newly selected days.
    const scheduled = hints.some(card => card.state === '!') ? [...cards, ...this.scheduled_cards(path)] : cards
    for (const card of hints) {
      const unit = card.state.at(-1)
      // The parser accepts any number of hint digits; the interval is capped so the due date stays representable.
      const days = card.state === '!'
        ? pick_due_day(scheduled, 7, 21, now, this.state.config.rollover, random)
        : Math.min(MAX_HINT_DAYS, Number(card.state.slice(0, -1)) * (unit === 'w' ? 7 : unit === 'm' ? 30 : 1))
      card.state = 'k'
      card.due = serialize_date(add_review_days(now, days, this.state.config.rollover))
    }
    return { note: new Note(this.state, path, cards, now, problems), scheduling_changed: hints.length > 0 }
  }

  /**
   * Remove notes and empty folders, then insert notes, keeping each folder's children in display order.
   * A path holds a note or a folder, never both: a note inserted where a folder was removes that folder's
   * notes, and a folder needed where a note was replaces the note. Removing a folder that still has notes
   * does nothing; remove its notes instead.
   */
  update(remove: string[], upsert: Note[]): void {
    /* Prune removed branches from the leaves, then attach each new note through its ancestors. */
    const nodes = this.state.nodes
    for (const path of remove) this.prune(path)

    // A single insertion loop covers startup, new files and changed files.
    for (const note of upsert) {
      const existing = nodes[note.path]
      // A replaced note keeps its links and position.
      if (existing?.type === NOTE) {
        nodes[note.path] = note
        continue
      }
      if (existing) for (const path of this.notes_at(note.path)) this.prune(path)
      nodes[note.path] = note
      let child = note.path
      for (let path = get_parent(child); path !== null; path = get_parent(path)) {
        if (nodes[path]?.type === NOTE) this.prune(path)
        const folder = (nodes[path] ??= new Folder(path)) as Folder
        // Binary search by exact path order; every compared child already has its node.
        const inserted = sibling(nodes[child])
        let low = 0
        let high = folder.children.length
        while (low < high) {
          const middle = (low + high) >> 1
          if (compare_siblings(sibling(nodes[folder.children[middle]]), inserted) < 0) low = middle + 1
          else high = middle
        }
        // A linked child means its ancestors are linked too.
        if (folder.children[low] === child) break
        folder.children.splice(low, 0, child)
        child = path
      }
    }
  }

  /** Remove a note or an empty folder, then every ancestor folder this leaves empty, except the root. */
  private prune(path: string): void {
    /* Walk up from the removed node, unlinking it from its parent until a parent keeps other children. */
    const nodes = this.state.nodes
    let node = nodes[path]
    if (!node || (node.type === FOLDER && node.children.length)) return
    while (node.path) {
      const parent = nodes[get_parent(node.path)!] as Folder | undefined
      delete nodes[node.path]
      if (!parent) break
      parent.children = parent.children.filter(child => child !== node.path)
      if (parent.children.length) break
      node = parent
    }
  }

  /** The note at path, or every note below the folder at path; none for other paths. */
  notes_at(path: string): string[] {
    const node = this.state.nodes[path]
    if (!node) return []
    return node.type === NOTE ? [path] : node.children.flatMap(child => this.notes_at(child))
  }

  /** Select a note path and card ordinal, independently of persisted card references. */
  next_card(scope: string, now: number = Date.now()): [string, number] | [null, null] {
    /* Refresh daily queues, scan the scope depth-first in display order, then honor the configured queue priority. */
    if (this.state.has_rolled_over(now)) this.state.recount(now)
    const node = this.state.nodes[scope]
    if (!node) return [null, null]
    /** First available candidates for each queue; intraday also tracks its earliest due instant. */
    let new_due: [string, number] | null = null
    let interday_due: [string, number] | null = null
    let intraday_due: [[string, number], number] | null = null
    // Children are pushed in reverse so they are popped, and their notes served, in display order.
    const stack: (Note | Folder)[] = [node]
    while (stack.length) {
      const current = stack.pop()!
      if (current.type === NOTE) {
        if (!new_due && current.new.length) new_due = [current.path, current.new[0].ordinal]
        if (!interday_due && current.interday.length) interday_due = [current.path, current.interday[0].ordinal]
        const first = current.intraday[0]
        if (first) {
          const due = parse_date(first.due)!.getTime()
          if (due <= now && (!intraday_due || due < intraday_due[1])) intraday_due = [[current.path, first.ordinal], due]
        }
      } else {
        for (let index = current.children.length - 1; index >= 0; index--) stack.push(this.state.nodes[current.children[index]])
      }
    }
    for (const queue of this.state.config.queue_order) {
      if (queue === 'intraday' && intraday_due) return intraday_due[0]
      if (queue === 'interday' && interday_due) return interday_due
      if (queue === 'new' && new_due) return new_due
    }
    return [null, null]
  }

  /**
   * The card of a loaded card ordinal as a rating would leave it, without changing state.
   * Hosts save the note with it and commit it with apply() only once the save succeeded.
   */
  rated(path: string, ordinal: number, rating: ReviewRating, date: Date = new Date()): Card {
    /* Copy the card, then resolve a fixed-interval choice or call FSRS on the copy. */
    const card = { ...(this.state.nodes[path] as Note).cards[ordinal - 1] }
    if (typeof rating === 'string') {
      const days = rating === 'tomorrow' ? 1
        : pick_due_day(this.scheduled_cards(), rating === 'soon' ? 3 : 7, rating === 'soon' ? 5 : 21,
          date, this.state.config.rollover, Math.random)
      card.reps++
      set_due_in(card, days, date, this.state.config.rollover)
    } else {
      apply_fsrs(card, this.fsrs.next(to_fsrs(card), date, rating).card)
    }
    return card
  }

  /** Commit a card from rated() to its note, which rebuilds the note's queues. */
  apply(path: string, card: Card, date: Date = new Date()): void {
    /* Replace the card at its ordinal and rebuild today's queues of its note. */
    const note = this.state.nodes[path] as Note
    note.cards[card.ordinal - 1] = card
    note.requeue(date)
  }

  /** Rate a loaded card ordinal and commit the result at once; persisting hosts use rated() and apply(). */
  review(path: string, ordinal: number, rating: ReviewRating, date: Date = new Date()): void {
    this.apply(path, this.rated(path, ordinal, rating, date), date)
  }

  /** Preview FSRS intervals for a loaded card ordinal without changing its scheduling. */
  peek(path: string, ordinal: number, date: Date = new Date()): ReviewIntervals {
    /* Decode once, then calculate all four grades at the same instant. */
    const note = this.state.nodes[path] as Note
    const card = to_fsrs(note.cards[ordinal - 1])
    /** Measure one prospective grade without assigning its result back to the live card. */
    const due = (grade: Grade): Interval => {
      /* Prefer full review days, otherwise express the short learning interval in minutes. */
      const future = this.fsrs.next(card, date, grade).card
      return future.scheduled_days
        ? { unit: 'days', count: future.scheduled_days }
        : { unit: 'minutes', count: Math.round((future.due.getTime() - date.getTime()) / 60000) }
    }
    return { again: due(Rating.Again), hard: due(Rating.Hard), good: due(Rating.Good), easy: due(Rating.Easy) }
  }

  /** Gather loaded note cards for due-day balancing, optionally excluding a note being replaced. */
  private scheduled_cards(exclude?: string): Scheduling[] {
    /* Skip folder counters and the old copy of a replacement note. Called only for load balancing. */
    const cards: Scheduling[] = []
    for (const node of Object.values(this.state.nodes)) {
      if (node.type === NOTE && node.path !== exclude) cards.push(...node.cards)
    }
    return cards
  }
}
