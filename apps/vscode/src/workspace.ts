import * as vscode from 'vscode'
import { m } from '@srmd/l10n'
import { FOLDER, NOTE } from '@srmd/scheduler'
import { Workspace as NoteWorkspace, error_text, type Storage } from '@srmd/workspace'
import { find_files, read_file, stat_path, str_to_uri, uri_to_str, write_file } from './filesystem'
import type { Settings } from './settings'

/** The shared workspace's file access: VS Code's file system API. */
const storage: Storage = { read: read_file, write: write_file }

/** Say that count notes newly have problems, offering the log that lists them; nothing for none. */
function notify(log: vscode.LogOutputChannel, count: number): void {
  if (!count) return
  void vscode.window.showWarningMessage(m.workspace_problems_found({ count }), m.vscode_show_log()).then(choice => {
    if (choice) log.show()
  })
}

/**
 * The notes of the first workspace folder: loading, watching and saving them. The shared workspace loads, reviews and
 * saves notes as tasks (see its run()); this host finds them with VS Code's file search and watcher, shows loading
 * progress, recounts every minute and announces problems with a notification that opens the log.
 *
 * The task queue also orders the watcher after this extension's own writes, so their echoes can be recognized.
 * Loads, workspace switches, watcher batches, review saves and the periodic recount all run as tasks; without the
 * queue they would interleave at their file I/O, mixing two workspaces or applying an older read last.
 *
 * While srmd is off (Settings.enabled), the workspace holds no folder: nothing is searched, watched,
 * recounted or decorated. Turning it on loads the folder, and turning it off unloads it.
 */
export class Workspace extends NoteWorkspace implements vscode.Disposable {
  /** The settings last applied, including whether srmd is on. */
  protected declare settings: Settings
  /**
   * Content changes of notes, and creations/deletions of any path: VS Code reports a moved or deleted folder only as the
   * folder.
   */
  private watchers: vscode.FileSystemWatcher[] = []
  /** Paths reported by the watcher since its last batch; a short debounce groups bursts into one task. */
  private changed = new Set<string>()
  private debounce: ReturnType<typeof setTimeout> | null = null
  /** Modification time of each file this extension wrote, so the watcher batch skips that echo. */
  private written = new Map<string, number>()
  /** Pending once-a-minute recount, for due-time and review-day transitions. */
  private timer: ReturnType<typeof setTimeout> | null = null
  private disposed = false

  /** Create an empty workspace; log records skipped notes and failed writes, on_refresh publishes counts after each recount. */
  constructor(settings: Settings, private readonly channel: vscode.LogOutputChannel, on_refresh: () => Promise<void>) {
    super(storage, settings, channel, { refreshed: on_refresh, problems: count => notify(channel, count) })
  }

  /** Load the first workspace folder, replacing the previous one, or unload it while srmd is off, as a task. */
  load(): Promise<void> {
    return this.run(() => this.load_folder())
  }

  /**
   * Apply changed settings, as a task. The folder loads again only when what decides the notes changed: srmd turned on
   * or off, the first workspace folder, or the suffixes. Otherwise the scheduler options take effect on the notes
   * loaded, every note's queues rebuilt, as a rollover moves the review days.
   */
  reconfigure(settings: Settings): Promise<void> {
    return this.run(async () => {
      const suffixes = JSON.stringify(this.settings.suffixes)
      this.configure(settings)
      const folder = this.folder()
      if ((folder?.path ?? null) !== this.state.root || JSON.stringify(settings.suffixes) !== suffixes) return this.load_folder(folder)
      this.state.last_recount = null
      await this.refresh()
    })
  }

  /**
   * Write a note, making text the loaded note's version, and remember the file's modification time so the
   * watcher skips its echo. Call within a task.
   */
  override async save(path: string, text: string): Promise<void> {
    /* Read the committed modification time after writing; the echo's batch runs after this task. */
    await super.save(path, text)
    const stat = await stat_path(path)
    if (stat) this.written.set(path, stat.mtime)
  }

  /** Stop watching and recounting; tasks already queued still finish. */
  dispose(): void {
    this.disposed = true
    this.unwatch()
    this.stop_timer()
  }

  /** Glob for note files below the workspace folder. */
  private get pattern(): string {
    return `**/*{${this.settings.suffixes.join(',')}}`
  }

  /** The folder srmd loads: the first workspace folder, saying so when there are more; none while srmd is off. */
  private folder(): vscode.Uri | undefined {
    const folders = this.settings.enabled ? vscode.workspace.workspaceFolders ?? [] : []
    // Multi-root workspaces are not supported; say which folder is used.
    if (folders.length > 1) this.channel.info(m.vscode_first_folder_only({ name: folders[0].name }))
    return folders[0]?.uri
  }

  /** Replace the loaded notes with those of folder, or with none without one. Runs as a task. */
  private async load_folder(folder = this.folder()): Promise<void> {
    /*
     * 1. Stop the previous folder's watcher and timer, and reset the state to the new root. While srmd is
     *    off, or no folder is open, the state stays empty and its publication clears the views and badges.
     * 2. Count the empty state, which starts the review day, and watch before reading, so changes during the load
     *    are applied by a later task.
     * 3. Add the folder's notes (see add()), publish counts, announce notes with problems, and restart the timer.
     *    Publishing rebuilds the queues only if the load crossed the review day's rollover.
     */
    if (this.disposed) return
    this.unwatch()
    this.stop_timer()
    this.scheduler.load(folder ? folder.path : null)
    if (!folder) {
      await this.refresh()
      return
    }

    // Each note builds its queues when created. Without a count first, the state has no review day yet, and the
    // count after loading would build every note's queues again.
    this.state.recount()
    this.watch(folder)
    /** Loaded notes that have problems, announced once the counts are published. */
    let problems = 0
    try {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: m.vscode_loading(), cancellable: false }, async () => {
        problems = await this.add(await find_files(folder, this.pattern))
      })
    } catch (error: unknown) {
      // The folder could not be listed: it shows no notes, and the watcher loads those that change.
      const message = m.vscode_load_failed({ detail: error_text(error) })
      this.channel.error(message)
      void vscode.window.showErrorMessage(message)
    }
    await this.refresh()
    notify(this.channel, problems)
    this.start_timer()
  }

  /** Report changed notes, and any path created or deleted, below folder. */
  private watch(folder: vscode.Uri): void {
    /* VS Code drops the events of a deleted folder's contents and reports only the folder, which a note glob would filter out. */
    const notes = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, this.pattern), true, false, true)
    notes.onDidChange(this.on_file_event)
    const paths = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '**/*'), false, true, false)
    paths.onDidCreate(this.on_file_event)
    paths.onDidDelete(this.on_file_event)
    this.watchers = [notes, paths]
  }

  /** Stop the watcher and forget its unprocessed paths and recorded writes. */
  private unwatch(): void {
    if (this.debounce) clearTimeout(this.debounce)
    this.debounce = null
    this.changed.clear()
    this.written.clear()
    for (const watcher of this.watchers) watcher.dispose()
    this.watchers = []
  }

  /** Collect a reported path and queue one batch once the reports pause for 100 ms. */
  private readonly on_file_event = (uri: vscode.Uri): void => {
    /* The batch is a task, so it runs after any write in progress, including the one that caused this report. */
    this.changed.add(uri_to_str(uri))
    if (this.debounce) clearTimeout(this.debounce)
    this.debounce = setTimeout(() => {
      this.debounce = null
      void this.run(() => this.apply_changes())
    }, 100)
  }

  /** Apply the reported paths: remove deleted notes and folders, load moved-in folders, reload changed notes. Runs as a task. */
  private async apply_changes(): Promise<void> {
    /*
     * 1. Take the collected paths; a later report starts a new batch.
     * 2. Classify each path by what is on disk now, whatever the tree held there before:
     *    - missing: remove its note, or every note below a deleted folder;
     *    - folder: list its notes afresh, since moves and renames report only the folder. Loaded notes below
     *      it that the listing lacks are removed, as is a note that a folder of the same name replaced;
     *    - file: remove the notes of a folder it replaced, then load it if it is a note, unless it is still
     *      at the version this extension wrote. Other files are ignored.
     * 3. Apply the result (see apply()): reparse the collected notes, update the tree, publish counts, persist
     *    resolved hints, then report notes that gained problems.
     * Only a confirmed absence removes a note: any other failure keeps its previous state and is logged,
     * and the next reported change tries again.
     */
    const paths = [...this.changed]
    this.changed.clear()
    const remove: string[] = []
    const load = new Set<string>()
    for (const path of paths) {
      const written = this.written.get(path)
      this.written.delete(path)
      try {
        const stat = await stat_path(path)
        const node = this.state.nodes[path]
        if (!stat) remove.push(...this.scheduler.notes_at(path))
        else if (stat.folder) {
          const found = new Set(await find_files(str_to_uri(path), this.pattern))
          remove.push(...this.scheduler.notes_at(path).filter(note => !found.has(note)))
          for (const note of found) load.add(note)
        } else {
          if (node?.type === FOLDER) remove.push(...this.scheduler.notes_at(path))
          if (this.is_note(path) && (node?.type !== NOTE || stat.mtime !== written)) load.add(path)
        }
      } catch (error: unknown) {
        this.channel.error(m.workspace_note_kept({ path, detail: error_text(error) }))
      }
    }
    await this.apply(remove, load)
  }

  /** Schedule the next recount, unless disposed or no folder is loaded. */
  private start_timer(): void {
    if (this.timer || !this.watchers.length || this.disposed) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.run(async () => {
        await this.refresh()
        this.start_timer()
      })
    }, 60_000)
  }

  /** Cancel the pending recount. */
  private stop_timer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}
