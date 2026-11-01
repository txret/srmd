// The workspace's storage on Android (ARCHITECTURE.md, "Storage and workspace"): reads, cached loads and guarded writes.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AndroidStorage } from '../src/storage.ts'
import * as tests from './storage.test.mjs'

/**
 * A bridge answering files.read, files.load and files.write from files, by path, as { text, mtime }; it records every
 * request. A write naming an expected time other than the file's is refused as the shell refuses it.
 */
function fake_bridge(files) {
  const bridge = {
    requests: [],
    async request(method, params) {
      bridge.requests.push([method, params])
      const file = files[params.path]
      if (method === 'files.read') return { text: file.text, mtime: file.mtime, size: Buffer.byteLength(file.text) }
      if (method === 'files.load') return { text: file.text }
      if (params.expected_mtime !== undefined && params.expected_mtime !== file?.mtime) {
        throw Object.assign(new Error(`${params.path} changed`), { code: 'conflict' })
      }
      files[params.path] = { text: params.text, mtime: (file?.mtime ?? 0) + 10 }
      return { mtime: files[params.path].mtime, size: Buffer.byteLength(params.text) }
    }
  }
  return bridge
}

/** A text cache in memory, as the IndexedDB cache behaves after loading. */
function fake_cache(entries = {}) {
  const texts = { ...entries }
  return {
    texts, get: path => texts[path], put: (path, entry) => { texts[path] = entry }, delete: path => { delete texts[path] },
    paths: () => Object.keys(texts)
  }
}

/** A scan drops the kept texts of the files it does not list, also of files deleted while the app was closed. */
export function test_a_scan_drops_the_texts_of_files_no_longer_listed() {
  const cache = fake_cache({ 'a.sr.md': { text: 'Q:: a', mtime: 1, size: 5 }, 'gone.md': { text: 'Old', mtime: 1, size: 3 } })
  const storage = new AndroidStorage(fake_bridge({}), cache)
  storage.set_entries([{ path: 'a.sr.md', mtime: 1, size: 5 }])
  assert.deepEqual(Object.keys(cache.texts), ['a.sr.md'])
}

/**
 * Loading takes the cached text while the scan shows the same time and size. Otherwise it loads the file's text alone,
 * which replaces the cached one with the scan's time and size; a file the scan did not list is read with its own.
 * read() always reads the file.
 */
export async function test_loading_uses_the_cache_only_while_the_scan_matches_it() {
  const files = { 'a.sr.md': { text: 'Q:: new', mtime: 20 }, 'b.sr.md': { text: 'Q:: b', mtime: 7 }, 'c.sr.md': { text: 'Q:: c', mtime: 3 } }
  const cache = fake_cache({ 'a.sr.md': { text: 'Q:: old', mtime: 10, size: 7 }, 'b.sr.md': { text: 'Q:: b', mtime: 7, size: 5 } })
  const bridge = fake_bridge(files)
  const storage = new AndroidStorage(bridge, cache)
  storage.set_entries([{ path: 'a.sr.md', mtime: 20, size: 7 }, { path: 'b.sr.md', mtime: 7, size: 5 }])
  assert.equal(await storage.load('b.sr.md'), 'Q:: b')
  assert.deepEqual(bridge.requests, [])
  assert.equal(await storage.load('a.sr.md'), 'Q:: new')
  assert.deepEqual(cache.texts['a.sr.md'], { text: 'Q:: new', mtime: 20, size: 7 })
  assert.equal(await storage.load('c.sr.md'), 'Q:: c')
  assert.deepEqual(cache.texts['c.sr.md'], { text: 'Q:: c', mtime: 3, size: 5 })
  assert.equal(await storage.read('b.sr.md'), 'Q:: b')
  assert.deepEqual(bridge.requests, [
    ['files.load', { path: 'a.sr.md' }], ['files.read', { path: 'c.sr.md' }], ['files.read', { path: 'b.sr.md' }]
  ])
}

/**
 * A file changed after the scan loads with the scan's time, older than its own: a write based on the loaded text is
 * refused, so it never replaces a change it was not based on, and the next scan finds the cached text out of date.
 */
export async function test_a_file_changed_after_the_scan_loads_with_the_scans_time() {
  const files = { 'a.sr.md': { text: 'Q:: synced', mtime: 30 } }
  const cache = fake_cache()
  const storage = new AndroidStorage(fake_bridge(files), cache)
  storage.set_entries([{ path: 'a.sr.md', mtime: 20, size: 5 }])
  assert.equal(await storage.load('a.sr.md'), 'Q:: synced')
  assert.deepEqual(cache.texts['a.sr.md'], { text: 'Q:: synced', mtime: 20, size: 5 })
  await assert.rejects(storage.write('a.sr.md', 'Q:: hint'), { code: 'conflict' })
  assert.equal(files['a.sr.md'].text, 'Q:: synced')
  storage.set_entries([{ path: 'a.sr.md', mtime: 30, size: 10 }])
  assert.equal(storage.current('a.sr.md'), undefined)
}

/**
 * A write names the time of the text it is based on, the last one read or loaded for its path, so the shell refuses it
 * when the file changed since; a successful write becomes the new base and the cached text.
 */
export async function test_writes_name_the_time_of_the_text_they_are_based_on() {
  const files = { 'a.sr.md': { text: 'Q:: a', mtime: 20 } }
  const cache = fake_cache({ 'a.sr.md': { text: 'Q:: a', mtime: 20, size: 5 } })
  const bridge = fake_bridge(files)
  const storage = new AndroidStorage(bridge, cache)
  storage.set_entries([{ path: 'a.sr.md', mtime: 20, size: 5 }])
  await storage.load('a.sr.md')
  await storage.write('a.sr.md', 'Q:: b')
  await storage.write('a.sr.md', 'Q:: c')
  assert.deepEqual(bridge.requests, [
    ['files.write', { path: 'a.sr.md', text: 'Q:: b', expected_mtime: 20 }],
    ['files.write', { path: 'a.sr.md', text: 'Q:: c', expected_mtime: 30 }]
  ])
  assert.deepEqual(cache.texts['a.sr.md'], { text: 'Q:: c', mtime: 40, size: 5 })
  assert.equal(storage.current('a.sr.md'), 'Q:: c')

  // A sync changes the file: the next write, still based on the text written last, is refused.
  files['a.sr.md'] = { text: 'Q:: synced', mtime: 99 }
  await assert.rejects(storage.write('a.sr.md', 'Q:: d'), { code: 'conflict' })
  assert.equal(files['a.sr.md'].text, 'Q:: synced')
}

/** A scan that no longer lists a file forgets its cached text; a listed file's text is current only at its time and size. */
export function test_a_scan_forgets_texts_of_files_gone() {
  const cache = fake_cache({ 'a.md': { text: 'A', mtime: 1, size: 1 }, 'b.md': { text: 'B', mtime: 1, size: 1 } })
  const storage = new AndroidStorage(fake_bridge({}), cache)
  storage.set_entries([{ path: 'a.md', mtime: 1, size: 1 }, { path: 'b.md', mtime: 1, size: 1 }])
  storage.set_entries([{ path: 'a.md', mtime: 2, size: 1 }])
  assert.deepEqual(Object.keys(cache.texts), ['a.md'])
  assert.equal(storage.current('a.md'), undefined)
  assert.equal(storage.current('b.md'), undefined)
}

// Run every test_ function above as a test named after it.
for (const [name, fn] of Object.entries(tests)) if (name.startsWith('test_')) test(name, fn)
