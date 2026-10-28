import { m } from '../../l10n/src'
import { parse, persist_hints, serialize, type ParsedNote } from '../../parser/src'
import { NOTE, Scheduler, State, type Note, type ReviewRating } from '../../scheduler/src'
import { note_from_parse, prepare_review, problem_text, type ReviewData } from '../../reviewer/src'
import type { WorkspaceSettings } from './settings'

/**
 * A host's file access, by workspace-relative slash-separated path (`topic/a.sr.md`). Each call reads or writes the
 * file itself, never a copy the host could hold for longer, except load().
 */
export interface Storage {
  /** The file's current text, decoded as UTF-8. */
  read(path: string): Promise<string>
  /** Replace the file's text, encoded as UTF-8. */
  write(path: string, text: string): Promise<void>
  /**
   * The text to load a note from when the workspace loads, which may come from a copy the host checked against the
   * file, such as a cache whose modification time matches; read() is used without it. Ratings and edits always
   * read the file again before saving, so a copy never decides what is written.
   */
  load?(path: string): Promise<string>
}

/** Where the workspace reports what happened: the host's log, such as VS Code's output channel. */
export interface Log {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

/** What the workspace tells its host. */
export interface WorkspaceEvents {
  /** Counts were recounted: publish them, such as redrawing views. Awaited, so a task ends with them published. */
  refreshed(): Promise<void>
  /** count notes newly have problems; tell the user, pointing to the log that lists them. Called with 0 too. */
  problems(count: number): void
}

/** A selected card with the parse its rating will be saved through, and what the review shows. */
export interface PreparedCard {
  path: string
  ordinal: number
  parsed: ParsedNote
  data: ReviewData
}

/**
 * How saving a rating ended: saved, dropped because the note changed after its card was shown (the note is
 * reloaded from its new text), or failed to read or write the note, leaving memory unchanged and the card due.
 */
export type RateResult = { status: 'saved' } | { status: 'changed' } | { status: 'failed'; error: unknown }

/** A note whose resolved scheduling hints still need writing. */
type Rewrite = { path: string; text: string }

/** The message of a thrown value, for logs and notifications. */
export const error_text = (error: unknown): string => error instanceof Error ? error.message : String(error)

/**
 * Run task for every item, in order, with at most limit tasks in flight: each worker takes the next item not yet
 * taken, so a worker done with a quick item helps with the rest while another waits on a slow one.
 */
export async function each_limited<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  /** The next item no worker has taken. */
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await task(items[next++])
  }))
}

/**
 * The notes of a folder: loading, reviewing and saving them the same way in every host, over the host's Storage.
 * Hosts find the notes, such as by listing or watching their folder, and present the state; they extend this class or
 * call it.
 *
 * Every change to the shared state runs as a task, one at a time and in submission order (see run()). Loads,
 * reloads, review selection and saves each await file I/O; without the queue they would interleave there, applying an
 * older read last or saving a rating over a newer edit. Methods documented "Call within a task" must run inside one.
 *
 * Problems of a note, such as a definition no cloze uses, are written to the log, and the host announces notes newly
 * having problems. Such notes are never written automatically: a save could remove what the problem names, so only
 * a review or an edit the user chose to make saves them. Resolved hints change only their own fields and are saved.
 */
export class Workspace {
  /** Portable note/folder tree, queues and counts, which hosts present. */
  readonly state: State
  readonly scheduler: Scheduler
  /** End of the task chain: each task starts once the previous one has settled. */
  private tail: Promise<unknown> = Promise.resolve()

  /** Create an empty workspace; load notes with add() after scheduler.load(). */
  constructor(
    protected readonly storage: Storage, protected settings: WorkspaceSettings,
    protected readonly log: Log, protected readonly events: WorkspaceEvents
  ) {
    this.state = new State(settings.scheduler)
    this.scheduler = new Scheduler(this.state)
  }

  /**
   * Run a task after every earlier one has settled; its failure rejects only the returned promise.
   * Tasks must not call run() themselves: the nested task would wait for the task awaiting it.
   */
  run<T>(task: () => Promise<T>): Promise<T> {
    /* Chain the task, and keep the chain usable when it fails. */
    const result = this.tail.then(task)
    this.tail = result.catch(() => undefined)
    return result
  }

  /** Use changed settings: scheduler options take effect at once; the host reloads the notes for other changes. */
  configure(settings: WorkspaceSettings): void {
    this.settings = settings
    Object.assign(this.state.config, settings.scheduler)
  }

  /** Whether a path names a note file by its suffix. */
  is_note(path: string): boolean {
    return this.settings.suffixes.some(suffix => path.endsWith(suffix))
  }

  /** Read and parse a note, with the optional extensions the settings turn on. */
  async read(path: string): Promise<ParsedNote> {
    return parse(await this.storage.read(path), this.settings.extensions)
  }

  /**
   * Read, parse and insert notes, as the workspace loads, with up to eight reads in flight; then persist resolved
   * hints. Each note builds its queues as it is inserted, so count the empty state first, which starts the review day.
   * An unreadable note is logged and left out. Call within a task.
   * @returns How many of the notes have problems, for the host to announce once counts are published.
   */
  async add(paths: string[]): Promise<number> {
    /* Insert each note as its text arrives; folder children keep their display order regardless. */
    const rewrites: Rewrite[] = []
    /** Loaded notes that have problems. */
    let problems = 0
    await each_limited(paths, 8, async path => {
      try {
        const text = this.storage.load ? await this.storage.load(path) : await this.storage.read(path)
        const note = this.build(path, parse(text, this.settings.extensions), rewrites)
        this.scheduler.update([], [note])
        if (note.problems.length) problems++
      } catch (error: unknown) {
        this.log.error(m.workspace_note_skipped({ path, detail: error_text(error) }))
      }
    })
    await this.persist(rewrites)
    return problems
  }

  /**
   * Apply changes found on disk: remove the notes at the remove paths, and read, parse and insert or replace the notes
   * at the load paths. Then publish counts, persist resolved hints and announce notes that gained problems. A note that
   * cannot be read keeps its previous state, or stays out, and is logged. Call within a task.
   */
  async apply(remove: string[], load: Iterable<string>): Promise<void> {
    /* Reparse the notes to load, then update the tree once; ordinary edits never cause writes, only resolved hints do. */
    const upsert: Note[] = []
    const rewrites: Rewrite[] = []
    /** Notes that have problems now but had none before, for one announcement. */
    let new_problems = 0
    for (const path of load) {
      try {
        const note = this.build(path, await this.read(path), rewrites)
        if (note.problems.length && !this.has_problems(path)) new_problems++
        upsert.push(note)
      } catch (error: unknown) {
        const message = this.state.nodes[path] ? m.workspace_note_kept : m.workspace_note_skipped
        this.log.error(message({ path, detail: error_text(error) }))
      }
    }
    if (!remove.length && !upsert.length) return
    this.scheduler.update(remove, upsert)
    await this.refresh()
    await this.persist(rewrites)
    this.events.problems(new_problems)
  }

  /** Write a note, making text the loaded note's version. Call within a task. */
  async save(path: string, text: string): Promise<void> {
    await this.storage.write(path, text)
    const node = this.state.nodes[path]
    if (node?.type === NOTE) node.version = text
  }

  /** Whether the loaded note at path was built from this parse's text, so its cards match what the parse shows. */
  is_current(path: string, parsed: ParsedNote): boolean {
    const node = this.state.nodes[path]
    return node?.type === NOTE && node.version === parsed.source
  }

  /** Replace the loaded note at path with one built from parsed, read anew, then publish counts. Call within a task. */
  async reload(path: string, parsed: ParsedNote): Promise<void> {
    /* Build and insert the note, publish the counts, then persist resolved hints and report new problems. */
    const rewrites: Rewrite[] = []
    const had_problems = this.has_problems(path)
    const note = this.build(path, parsed, rewrites)
    this.scheduler.update([], [note])
    await this.refresh()
    await this.persist(rewrites)
    this.events.problems(!had_problems && note.problems.length ? 1 : 0)
  }

  /** Recount queues and publish the counts. Call within a task. */
  async refresh(): Promise<void> {
    this.state.recount()
    await this.events.refreshed()
  }

  /** The loaded note at path, or every loaded note below the folder at path; none for other paths. */
  notes_at(path: string): string[] {
    const node = this.state.nodes[path]
    if (!node) return []
    return node.type === NOTE ? [path] : node.children.flatMap(child => this.notes_at(child))
  }

  /**
   * The next card of a note or folder path, read and prepared for display, or null when none is left. Call within a
   * task.
   */
  async next_card(scope: string): Promise<PreparedCard | null> {
    /* Pick a card and read its note; a note edited since it was loaded is reloaded first, and the pick repeats. */
    for (;;) {
      const [path, ordinal] = this.scheduler.next_card(scope)
      if (!path) return null
      const parsed = await this.read(path)
      if (this.is_current(path, parsed)) return { path, ordinal, parsed, data: prepare_review(this.scheduler, path, ordinal, parsed) }
      // The host has not applied this edit yet. Cards from the older text could be shown and saved under the
      // wrong clozes, so apply it now; the reloaded note may no longer have this card due.
      await this.reload(path, parsed)
    }
  }

  /**
   * Save a rating of a card from next_card(), then commit it to memory and publish counts. Call within a task.
   * The rating is dropped when the note changed after its card was shown: see RateResult.
   */
  async rate(card: PreparedCard, rating: ReviewRating): Promise<RateResult> {
    /*
     * 1. Read the note again. Text other than the shown note's means it was edited meanwhile: saving the shown
     *    parse would overwrite that edit, and the rating may belong to a cloze that changed. Reload the note
     *    from that text instead; the caller selects again.
     * 2. Rate a copy of the card and save the note with it. A failure leaves memory as it was, so the card stays due.
     * 3. Once saved, commit the card and publish the new counts before the next card is selected.
     */
    let current: ParsedNote
    try {
      current = await this.read(card.path)
    } catch (error: unknown) {
      return { status: 'failed', error }
    }
    if (current.source !== card.parsed.source || !this.is_current(card.path, current)) {
      await this.reload(card.path, current)
      return { status: 'changed' }
    }

    const now = new Date()
    const rated = this.scheduler.rated(card.path, card.ordinal, rating, now)
    const cards = (this.state.nodes[card.path] as Note).cards.map(other => other.ordinal === rated.ordinal ? rated : other)
    try {
      await this.save(card.path, serialize(current, cards))
    } catch (error: unknown) {
      return { status: 'failed', error }
    }
    this.scheduler.apply(card.path, rated, now)
    await this.refresh()
    return { status: 'saved' }
  }

  /**
   * Save an edit of a file, made from base: the text the file held when editing began. Unless base is null, which
   * overwrites, a file no longer holding base, edited meanwhile such as by a sync, is left unwritten: 'changed'.
   * A saved note is reloaded from its new text. Read and write failures reject. Call within a task.
   */
  async save_text(path: string, text: string, base: string | null): Promise<'saved' | 'changed'> {
    /* Compare the file with base, write the edit, then rebuild the note's cards from what was written. */
    if (base !== null && await this.storage.read(path) !== base) return 'changed'
    await this.save(path, text)
    if (this.is_note(path)) await this.reload(path, parse(text, this.settings.extensions))
    return 'saved'
  }

  /**
   * Build the note for a parse and log its problems. Resolved hints are queued in rewrites; persist_hints() changes
   * only their state and due fields, so this is safe even in a note with problems.
   */
  protected build(path: string, parsed: ParsedNote, rewrites: Rewrite[]): Note {
    /* Combine cards, invalid dates and definition problems in the shared builder, then log and queue. */
    const { note, scheduling_changed } = note_from_parse(this.scheduler, path, parsed)
    for (const problem of note.problems) this.log.warn(`${path}: ${problem_text(problem)}`)
    // Only actual scheduling changes, resolved hints, are persisted, and nothing else is normalized.
    if (scheduling_changed) rewrites.push({ path, text: persist_hints(parsed.source, parsed.hints, note.cards) })
    return note
  }

  /** Whether the note loaded at path has problems. */
  protected has_problems(path: string): boolean {
    const node = this.state.nodes[path]
    return node?.type === NOTE && node.problems.length > 0
  }

  /** Write resolved hints with up to four writes in flight. Call within a task. */
  protected async persist(rewrites: Rewrite[]): Promise<void> {
    /* A failed write is logged; that hint is resolved again on the next load. */
    await each_limited(rewrites, 4, async ({ path, text }) => {
      try {
        await this.save(path, text)
      } catch (error: unknown) {
        this.log.error(m.workspace_hint_save_failed({ path, detail: error_text(error) }))
      }
    })
  }
}
