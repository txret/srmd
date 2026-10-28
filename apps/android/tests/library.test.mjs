// The notes folder on Android (ARCHITECTURE.md, "Scanning"): the first scan loads notes, later scans apply changes.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { get_counts } from '../../../shared/scheduler/src/index.ts'
import { Library } from '../src/library.ts'
import { app_settings } from '../src/settings.ts'
import { AndroidStorage } from '../src/storage.ts'
import { search_files } from '../src/library_search.ts'
import * as tests from './library.test.mjs'

/**
 * A library over a bridge serving files, by path, as { text, mtime }: files.scan lists them all, as the shell would
 * after skipping. It records the requests' methods and what the workspace reported.
 */
function make_library(files) {
  const host = { requests: [], log: [], refreshes: 0, problems: [] }
  const bridge = {
    async request(method, params) {
      host.requests.push(method === 'files.scan' ? method : `${method} ${params.path}`)
      if (method === 'files.scan') return { entries: Object.entries(files).map(([path, file]) => ({ path, mtime: file.mtime, size: Buffer.byteLength(file.text) })) }
      const file = files[params.path]
      if (method === 'files.read') return { text: file.text, mtime: file.mtime, size: Buffer.byteLength(file.text) }
      if (method === 'files.load') return { text: file.text }
      files[params.path] = { text: params.text, mtime: file.mtime + 1 }
      return { mtime: file.mtime + 1, size: Buffer.byteLength(params.text) }
    }
  }
  const texts = {}
  const cache = { get: path => texts[path], put: (path, entry) => { texts[path] = entry }, delete: path => { delete texts[path] } }
  const log = { info: message => host.log.push(message), warn: message => host.log.push(message), error: message => host.log.push(message) }
  const events = { refreshed: async () => { host.refreshes++ }, problems: count => host.problems.push(count) }
  host.library = new Library(bridge, new AndroidStorage(bridge, cache), app_settings({}, () => {}), log, events, 'notes')
  return host
}

/**
 * The first scan lists every file and loads the notes, reading each once without asking its time again; other files
 * are listed but not read. A later scan reloads a note whose time changed, adds a new one and removes one gone, reading
 * only those.
 */
export async function test_the_first_scan_loads_notes_and_later_scans_apply_changes(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const files = {
    'a.sr.md': { text: 'Q:: one\n', mtime: 1 }, 'topic/b.sr.md': { text: 'Q:: two\n', mtime: 1 },
    'readme.md': { text: '# Notes\n', mtime: 1 }, 'diagram.png': { text: 'PNG', mtime: 1 }
  }
  const host = make_library(files)
  const { library } = host
  await library.scan()
  assert.deepEqual(host.requests, ['files.scan', 'files.load a.sr.md', 'files.load topic/b.sr.md'])
  assert.deepEqual(library.files.map(file => file.path), ['a.sr.md', 'topic/b.sr.md', 'readme.md', 'diagram.png'])
  assert.deepEqual(Object.keys(library.workspace.state.nodes).sort(), ['', 'a.sr.md', 'topic', 'topic/b.sr.md'])
  assert.deepEqual(host.problems, [0])

  files['a.sr.md'] = { text: 'Q:: one\n\nR:: more\n', mtime: 2 }
  delete files['topic/b.sr.md']
  files['c.sr.md'] = { text: 'Q:: three\n', mtime: 1 }
  host.requests.length = 0
  await library.scan()
  assert.deepEqual(host.requests, ['files.scan', 'files.read a.sr.md', 'files.read c.sr.md'])
  assert.deepEqual(Object.keys(library.workspace.state.nodes).sort(), ['', 'a.sr.md', 'c.sr.md'])
  assert.deepEqual(get_counts(library.workspace.state.nodes['a.sr.md']), { due: 0, new: 2, later: 0 })
}

/**
 * Showing a note reads it; a note changed since it loaded is reloaded in the background, so its counts follow. The
 * kinds of files follow the settings: notes by suffix, Markdown and text by extension, everything else other.
 */
export async function test_showing_a_changed_note_reloads_it(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const files = { 'a.sr.md': { text: 'Q:: one\n', mtime: 1 } }
  const host = make_library(files)
  const { library } = host
  await library.scan()
  files['a.sr.md'] = { text: 'Q:: one\n\nR:: two\n', mtime: 2 }
  assert.equal(await library.read('a.sr.md'), 'Q:: one\n\nR:: two\n')
  await library.workspace.run(async () => {})
  assert.deepEqual(get_counts(library.workspace.state.nodes['a.sr.md']), { due: 0, new: 2, later: 0 })
  assert.deepEqual(['a.sr.md', 'b.MD', 'log.txt', 'diagram.png'].map(path => library.kind(path)), ['note', 'markdown', 'text', 'other'])
}

/**
 * Searching all files matches names by every term and texts by the whole query, ignoring case, counting the text
 * matches; files without a text match by name only.
 */
export function test_searching_all_files_matches_names_and_texts() {
  const texts = { 'topic/heart.sr.md': 'The Heart pumps. heart rate', 'lungs.md': 'Air and the heart.', 'heart.png': undefined }
  const paths = ['topic/heart.sr.md', 'lungs.md', 'heart.png', 'liver.md']
  assert.deepEqual({ ...search_files('Heart', paths, path => texts[path]) }, { 'topic/heart.sr.md': 2, 'lungs.md': 1, 'heart.png': 0 })
  assert.deepEqual({ ...search_files('topic heart', paths, path => texts[path]) }, { 'topic/heart.sr.md': 0 })
  assert.deepEqual({ ...search_files('heart rate', paths, path => texts[path]) }, { 'topic/heart.sr.md': 1 })
  assert.deepEqual({ ...search_files('  ', paths, path => texts[path]) }, {})
}

// Run every test_ function above as a test named after it.
for (const [name, fn] of Object.entries(tests)) if (name.startsWith('test_')) test(name, fn)
