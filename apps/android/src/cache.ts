/** What the app keeps between starts in the page's IndexedDB: the texts of files it read, and a few values. */
import type { FileEntry } from '@srmd/workspace'

/** A file's text with the modification time and size the file had, which tell whether the text is still current. */
export interface CachedText {
  text: string
  mtime: number
  size: number
}

/** File texts by workspace-relative path, read synchronously; changes are kept in the background. */
export interface TextCache {
  get(path: string): CachedText | undefined
  put(path: string, entry: CachedText): void
  delete(path: string): void
}

/** An edit not yet saved, kept while the app is in the background in case Android ends it. */
export interface Draft {
  path: string
  text: string
  /** The file's text when editing began. */
  base: string
}

/** The values kept between starts, by key. */
export interface Values {
  /** The last scan's files, shown as the tree until the next scan finishes. */
  files: FileEntry[]
  /** The file shown last. */
  last: string
  /** Folder paths expanded in the tree. */
  expanded: { [path: string]: boolean }
  draft: Draft
}

/** Wait for an IndexedDB request. */
function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/**
 * The texts and values, in memory and in IndexedDB. Every text is loaded at start, since the library search reads
 * them all; writes go to IndexedDB in the background, and a failed write only costs a reread next time. Without
 * IndexedDB, as in a page that may not store data, everything stays in memory.
 */
export class Cache implements TextCache {
  /** Texts by path, without a prototype, so any path is an ordinary key. */
  private texts: { [path: string]: CachedText } = Object.create(null)

  private constructor(private readonly db: IDBDatabase | null, private readonly log: (message: string) => void) {}

  /** Open the database, creating its stores on first use, and load every text; log reports failures. */
  static async open(log: (message: string) => void): Promise<Cache> {
    /* Open or create version 1 with a store per kind, then read all texts with one cursor. */
    let db: IDBDatabase | null = null
    try {
      const request = indexedDB.open('srmd', 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore('texts')
        request.result.createObjectStore('values')
      }
      db = await done(request)
    } catch (error: unknown) {
      log(`IndexedDB unavailable, nothing is kept between starts: ${String(error)}`)
    }
    const cache = new Cache(db, log)
    if (!db) return cache
    const store = db.transaction('texts').objectStore('texts')
    const [keys, values] = await Promise.all([done(store.getAllKeys()), done(store.getAll())])
    keys.forEach((key, index) => { cache.texts[String(key)] = values[index] as CachedText })
    return cache
  }

  /** The text kept for path, if any; whether it is current is the caller's to check. */
  get(path: string): CachedText | undefined {
    return this.texts[path]
  }

  /** Keep a file's text. */
  put(path: string, entry: CachedText): void {
    this.texts[path] = entry
    this.store('texts', store => store.put(entry, path))
  }

  /** Forget a file's text. */
  delete(path: string): void {
    delete this.texts[path]
    this.store('texts', store => store.delete(path))
  }

  /** Forget every text and value, as when the notes folder changes. */
  clear(): void {
    this.texts = Object.create(null)
    this.store('texts', store => store.clear())
    this.store('values', store => store.clear())
  }

  /** A kept value, or undefined. */
  async value<K extends keyof Values>(key: K): Promise<Values[K] | undefined> {
    if (!this.db) return undefined
    try {
      return await done(this.db.transaction('values').objectStore('values').get(key)) as Values[K] | undefined
    } catch (error: unknown) {
      this.log(`Could not read ${key}: ${String(error)}`)
      return undefined
    }
  }

  /** Keep a value, or forget it with undefined. */
  set_value<K extends keyof Values>(key: K, value: Values[K] | undefined): void {
    this.store('values', store => value === undefined ? store.delete(key) : store.put(value, key))
  }

  /**
   * Run a write on one store in the background, logging a failure. Values, such as a draft, are written to disk before
   * the write completes, so a crash right after keeps them; texts may be lost, as the next read restores them.
   */
  private store(name: 'texts' | 'values', write: (store: IDBObjectStore) => IDBRequest): void {
    if (!this.db) return
    try {
      const transaction = this.db.transaction(name, 'readwrite', { durability: name === 'values' ? 'strict' : 'relaxed' })
      write(transaction.objectStore(name))
      transaction.onerror = () => this.log(`Could not keep ${name}: ${String(transaction.error)}`)
    } catch (error: unknown) {
      this.log(`Could not keep ${name}: ${String(error)}`)
    }
  }
}
