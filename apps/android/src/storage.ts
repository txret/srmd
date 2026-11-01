/** The shared workspace's file access on Android: the shell's files through the bridge, with the text cache. */
import type { FileEntry, Storage } from '@srmd/workspace'
import type { Bridge } from './bridge'
import type { TextCache } from './cache'

/**
 * Storage over the bridge. read() always reads the file with its time and size; load() takes the cached text instead
 * while the last scan shows the file unchanged, so a start reads only files that changed, and those with the scan's
 * time and size.
 *
 * Every write is based on a text this storage handed out, from the file or the cache, and names that text's
 * modification time: the shell refuses the write when the file's time differs, as when a sync changed it meanwhile.
 * The workspace reads a note again just before saving a rating or an edit, so a refusal there is rare; it mainly
 * protects resolved hints, which are written from the text read at load.
 */
export class AndroidStorage implements Storage {
  /** The last scan's files by path: their times and sizes tell whether a cached text is current. */
  private entries: { [path: string]: FileEntry } = Object.create(null)
  /** Modification time of the text last handed out or written for each path, which a write names as expected. */
  private known: { [path: string]: number } = Object.create(null)

  /** Read and write through bridge, keeping texts in cache. */
  constructor(private readonly bridge: Bridge, private readonly cache: TextCache) {}

  /** Use a scan's files to judge cached texts; texts of files gone from the folder are forgotten. */
  set_entries(entries: FileEntry[]): void {
    /* Index the new entries, then drop the kept texts of paths not listed, also of files gone since an earlier session. */
    this.entries = Object.create(null)
    for (const entry of entries) this.entries[entry.path] = entry
    for (const path of this.cache.paths()) if (!(path in this.entries)) this.cache.delete(path)
  }

  /** The last scan's entry for path, if it listed one. */
  entry(path: string): FileEntry | undefined {
    return this.entries[path]
  }

  /** The cached text of path while the last scan shows its file unchanged; otherwise undefined. */
  current(path: string): string | undefined {
    const entry = this.entries[path]
    const cached = this.cache.get(path)
    return entry && cached && cached.mtime === entry.mtime && cached.size === entry.size ? cached.text : undefined
  }

  /** Read the file, keeping its text. */
  async read(path: string): Promise<string> {
    const { text, mtime, size } = await this.bridge.request('files.read', { path })
    this.known[path] = mtime
    this.cache.put(path, { text, mtime, size })
    // A file read after the scan, such as a new note, now has an entry; one the scan listed gets its current time.
    this.entries[path] = { path, mtime, size }
    return text
  }

  /** Write the file, unless it changed since its text was handed out; keep the new text. */
  async write(path: string, text: string): Promise<void> {
    const { mtime, size } = await this.bridge.request('files.write', { path, text, expected_mtime: this.known[path] })
    this.known[path] = mtime
    this.cache.put(path, { text, mtime, size })
    this.entries[path] = { path, mtime, size }
  }

  /**
   * The cached text while current, otherwise the file's. A file the last scan listed is read without asking the
   * shell for its time and size again, which saves two queries per file: the scan's go with the text. As the scan came
   * first, a file changed since pairs newer text with an older time, never older text with a newer one, so a write
   * based on it is refused as a conflict rather than saved over the change, and the next scan reads the file again.
   */
  async load(path: string): Promise<string> {
    /* Take the cached text, else load the listed file's text with the scan's time, else read the file. */
    const cached = this.current(path)
    const entry = this.entries[path]
    if (cached !== undefined) {
      this.known[path] = entry.mtime
      return cached
    }
    if (!entry) return this.read(path)
    const { text } = await this.bridge.request('files.load', { path })
    this.known[path] = entry.mtime
    this.cache.put(path, { text, mtime: entry.mtime, size: entry.size })
    return text
  }
}
