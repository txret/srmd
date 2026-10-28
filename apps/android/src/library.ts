/** The notes folder: its files from the shell's scans, and its notes in the shared workspace. */
import { NOTE } from '@srmd/scheduler'
import { Workspace, each_limited, error_text, file_kind, folder_children, type FileEntry, type FileKind, type Log, type WorkspaceEvents } from '@srmd/workspace'
import type { Bridge } from './bridge'
import type { AppSettings } from './settings'
import type { AndroidStorage } from './storage'

/**
 * The folder's files and notes. Android cannot watch a folder picked through the Storage Access Framework, so changes
 * made by a sync tool are found by scanning, which costs one query per folder (ARCHITECTURE.md, "Scanning"): the
 * first scan loads every note, later scans apply what changed. Between scans, a file is read whenever it is
 * shown, and a note found changed then is reloaded, so the shown note and its counts are current.
 */
export class Library {
  readonly workspace: Workspace
  /** The listing shown: the last scan's files, or before the first scan the last session's. */
  files: FileEntry[] = []
  /** The listing's folders and their children in display order, for tree_rows(). */
  children = folder_children([])
  /** Whether the workspace holds the notes: the first scan loads them, later ones apply changes. */
  private loaded = false

  /** A library of the folder named root_name; log records failures, events reach the app. */
  constructor(
    private readonly bridge: Bridge, readonly storage: AndroidStorage, private settings: AppSettings,
    private readonly log: Log, private readonly events: WorkspaceEvents, public root_name: string
  ) {
    this.workspace = new Workspace(storage, settings, log, events)
  }

  /** The kind of the file at path, by the note suffixes and the file types of the settings. */
  kind(path: string): FileKind {
    return file_kind(path, this.settings.suffixes, this.settings.types)
  }

  /** Whether the file at path opens in the app, so it can be shown, edited and searched. */
  opens(path: string): boolean {
    return this.kind(path) !== 'other'
  }

  /** Show a listing until a scan replaces it, such as the last session's. */
  list(files: FileEntry[]): void {
    this.files = files
    this.children = folder_children(files)
  }

  /**
   * Use changed settings. Scheduler options apply at once; changed suffixes, extensions, file types or skipped names
   * make the next scan load every note again.
   * @returns Whether the notes must be loaded again, which the caller does with scan().
   */
  configure(settings: AppSettings): boolean {
    /* Compare what decides which files are notes and how they parse, then hand the settings on. */
    // Extensions compare by count: the only optional extension is either on or off.
    const key = (value: AppSettings): string => JSON.stringify([value.suffixes, value.types, value.skip, value.extensions.length])
    if (key(this.settings) !== key(settings)) this.loaded = false
    this.settings = settings
    this.workspace.configure(settings)
    return !this.loaded
  }

  /**
   * Scan the folder and bring the workspace up to date: the first scan, or the first after settings changed, loads
   * every note; a later one removes notes no longer listed and reloads notes whose time or size changed. Rejects when
   * the shell cannot scan, keeping the previous listing.
   */
  async scan(): Promise<void> {
    /*
     * 1. List the folder through the shell.
     * 2. In a task: load all notes into an emptied workspace, or compare the listing with the storage's entries,
     *    which reads and writes since the last scan kept current, and apply the differences.
     */
    const { entries } = await this.bridge.request('files.scan', { skip: this.settings.skip })
    const notes = entries.filter(entry => this.kind(entry.path) === 'note')
    await this.workspace.run(async () => {
      const { scheduler, state } = this.workspace
      if (!this.loaded) {
        this.storage.set_entries(entries)
        this.list(entries)
        scheduler.load(this.root_name)
        // Notes build their queues as they are inserted; counting first starts the review day (see add()).
        state.recount()
        const problems = await this.workspace.add(notes.map(note => note.path))
        await this.workspace.refresh()
        this.events.problems(problems)
        this.loaded = true
        return
      }
      const changed = notes.filter(({ path, mtime, size }) => {
        const before = this.storage.entry(path)
        return !before || before.mtime !== mtime || before.size !== size || state.nodes[path]?.type !== NOTE
      }).map(note => note.path)
      const listed = new Set(notes.map(note => note.path))
      const removed = Object.keys(state.nodes).filter(path => state.nodes[path].type === NOTE && !listed.has(path))
      this.storage.set_entries(entries)
      this.list(entries)
      await this.workspace.apply(removed, changed)
      // A listing without note changes still changed the tree when other files came or went.
      if (!removed.length && !changed.length) await this.events.refreshed()
    })
  }

  /**
   * The current text of a file, read for showing it. A loaded note whose text differs from its version is reloaded in
   * the background, so its counts follow; showing it does not wait for that.
   */
  async read(path: string): Promise<string> {
    const text = await this.storage.read(path)
    if (this.loaded && this.kind(path) === 'note') {
      this.workspace.run(async () => {
        // Read again inside the task: another task may have loaded a newer text since.
        const parsed = await this.workspace.read(path)
        if (!this.workspace.is_current(path, parsed)) await this.workspace.reload(path, parsed)
      }).catch((error: unknown) => this.log.error(`${path}: ${error_text(error)}`))
    }
    return text
  }

  /**
   * Read the files that open in the app and have no current cached text, four at a time, for the search of all
   * files; after each, call progress, so results grow. Stops early when stop() returns true. Failed reads are logged.
   */
  async read_uncached(progress: () => void, stop: () => boolean): Promise<void> {
    const missing = this.files.filter(file => this.opens(file.path) && this.storage.current(file.path) === undefined)
    await each_limited(missing, 4, async file => {
      if (stop()) return
      try {
        await this.storage.read(file.path)
        progress()
      } catch (error: unknown) {
        this.log.warn(`${file.path}: ${error_text(error)}`)
      }
    })
  }
}
