// The shared workspace (ARCHITECTURE.md, "Workspace"): loading, review selection, saving ratings and edits, tasks.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setImmediate as settle } from 'node:timers/promises'
import MarkdownIt from 'markdown-it'
import { srmd_plugin } from '../../parser/src/index.ts'
import { Rating, get_counts } from '../../scheduler/src/index.ts'
import { Workspace, each_limited, read_settings } from '../src/index.ts'
import * as tests from './workspace.test.mjs'

/**
 * A workspace over in-memory files, with what it wrote, logged and reported. Each test supplies its files and fixes
 * the clock. Reading a missing file fails as a host's storage would; write_error makes every write fail.
 * @param files - Note texts by workspace-relative path; the storage reads and writes this object.
 * @param cache - Texts for Storage.load(), as a host's cache would hold them; omitted, the storage has no load().
 */
function make_workspace(files, cache) {
  const host = { files, writes: [], log: [], events: [], write_error: null }
  const storage = {
    read: async path => {
      if (!(path in files)) throw new Error(`No such file: ${path}`)
      return files[path]
    },
    write: async (path, text) => {
      if (host.write_error) throw host.write_error
      host.writes.push([path, text])
      files[path] = text
    }
  }
  if (cache) storage.load = async path => cache[path]
  const log = { info: message => host.log.push(['info', message]), warn: message => host.log.push(['warn', message]), error: message => host.log.push(['error', message]) }
  const events = { refreshed: async () => { host.events.push('refreshed') }, problems: count => { host.events.push(['problems', count]) } }
  host.workspace = new Workspace(storage, read_settings(() => undefined, () => {}), log, events)
  return host
}

/** Load the notes at paths into an empty workspace, as a host's start does; returns add()'s problem count. */
function load(workspace, paths) {
  return workspace.run(async () => {
    workspace.scheduler.load('/notes')
    workspace.state.recount()
    const problems = await workspace.add(paths)
    await workspace.refresh()
    return problems
  })
}

/**
 * Adding notes inserts them, writes only resolved hints, and logs a note that cannot be read instead of failing.
 * The hint `3d` becomes a known card due three review days later, at the 04:00 rollover; the other note is not written.
 */
export async function test_adding_notes_saves_only_resolved_hints_and_logs_unreadable_notes(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const host = make_workspace({
    'topic/a.sr.md': 'Q:: one\n',
    'b.sr.md': 'Hinted:: three[:1]\n\n[:1]: 3d\n'
  })
  assert.equal(await load(host.workspace, ['topic/a.sr.md', 'b.sr.md', 'missing.sr.md']), 0)
  assert.deepEqual(host.writes, [['b.sr.md', 'Hinted:: three[:1]\n\n[:1]: k 20261018040000\n']])
  assert.deepEqual(host.log, [['error', 'Skipped missing.sr.md: No such file: missing.sr.md']])
  assert.deepEqual(Object.keys(host.workspace.state.nodes).sort(), ['', 'b.sr.md', 'topic', 'topic/a.sr.md'])
  // The written text is the note's version, so the next read finds the note current.
  assert.equal(host.workspace.state.nodes['b.sr.md'].version, 'Hinted:: three[:1]\n\n[:1]: k 20261018040000\n')
  assert.deepEqual(host.events, ['refreshed'])
}

/**
 * Loading takes a note's text from the host's copy when the storage has load(), but review reads the file: a copy
 * older than the file is caught before its card is shown, and the note is reloaded from the file.
 */
export async function test_loading_uses_the_hosts_copy_and_review_reads_the_file(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const host = make_workspace({ 'a.sr.md': 'Q:: on disk\n' }, { 'a.sr.md': 'Q:: cached\n' })
  await load(host.workspace, ['a.sr.md'])
  assert.equal(host.workspace.state.nodes['a.sr.md'].version, 'Q:: cached\n')
  const card = await host.workspace.run(() => host.workspace.next_card(''))
  assert.equal(card.data.html, '<p>Q: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">on disk</span></p>')
  assert.equal(host.workspace.state.nodes['a.sr.md'].version, 'Q:: on disk\n')
}

/**
 * A rating is saved to the note, then committed: the card leaves today's queues and the counts are published.
 * The reviewed card is the overdue second one, served before the new first; Good schedules it 29 days ahead.
 */
export async function test_a_rating_is_saved_then_committed(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const host = make_workspace({
    'a.sr.md': 'Q:: one\n\nK:: two[:1]\n\n[:1]: k 20261014040000 7 20261007120000 8.5 4.2 0 10 1\n'
  })
  await load(host.workspace, ['a.sr.md'])
  const card = await host.workspace.run(() => host.workspace.next_card(''))
  assert.deepEqual([card.path, card.ordinal], ['a.sr.md', 2])
  assert.deepEqual(get_counts(host.workspace.state.nodes['a.sr.md']), { due: 1, new: 1, later: 0 })
  host.events.length = 0

  assert.deepEqual(await host.workspace.run(() => host.workspace.rate(card, Rating.Good)), { status: 'saved' })
  assert.deepEqual(host.writes, [
    ['a.sr.md', 'Q:: one\n\nK:: two[:1]\n\n[:1]: k 20261113110000 29 20261015120000 29.3706596 4.19102837 0 11 1\n']
  ])
  assert.deepEqual(get_counts(host.workspace.state.nodes['a.sr.md']), { due: 0, new: 1, later: 1 })
  assert.deepEqual(host.events, ['refreshed'])
}

/**
 * A rating for a note edited after its card was shown is dropped: saving the shown parse would overwrite the edit.
 * The note is reloaded from the edit, and nothing is written.
 */
export async function test_a_rating_of_a_note_edited_meanwhile_is_dropped(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const host = make_workspace({ 'a.sr.md': 'Q:: one\n' })
  await load(host.workspace, ['a.sr.md'])
  const card = await host.workspace.run(() => host.workspace.next_card(''))
  host.files['a.sr.md'] = 'Q:: one\n\nR:: two\n'

  assert.deepEqual(await host.workspace.run(() => host.workspace.rate(card, Rating.Good)), { status: 'changed' })
  assert.deepEqual(host.writes, [])
  assert.equal(host.workspace.state.nodes['a.sr.md'].version, 'Q:: one\n\nR:: two\n')
  assert.deepEqual(get_counts(host.workspace.state.nodes['a.sr.md']), { due: 0, new: 2, later: 0 })
}

/** A failed save reports its error and leaves memory as it was, so the card stays due. */
export async function test_a_failed_save_leaves_the_card_due(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const host = make_workspace({ 'a.sr.md': 'Q:: one\n' })
  await load(host.workspace, ['a.sr.md'])
  const card = await host.workspace.run(() => host.workspace.next_card(''))
  const error = new Error('read-only')
  host.write_error = error

  assert.deepEqual(await host.workspace.run(() => host.workspace.rate(card, Rating.Good)), { status: 'failed', error })
  assert.deepEqual(get_counts(host.workspace.state.nodes['a.sr.md']), { due: 0, new: 1, later: 0 })
  assert.equal(host.workspace.state.nodes['a.sr.md'].version, 'Q:: one\n')
}

/** A plugin of another instance: `{{text}}` renders as `<kbd>text</kbd>`, so `::` inside it is no marker. */
const keys = md => md.inline.ruler.before('emphasis', 'keys', (state, silent) => {
  /* Take `{{` up to `}}` on the line. */
  const match = /^\{\{([^}\n]*)\}\}/.exec(state.src.slice(state.pos))
  if (!match) return false
  if (!silent) state.push('html_inline', '', 0).content = `<kbd>${md.utils.escapeHtml(match[1])}</kbd>`
  state.pos += match[0].length
  return true
})

/**
 * A host can parse notes with another instance recording positions, such as one composed of other plugins too (use()).
 * A note loaded with srmd's own instance is read anew before its card shows, since the other instance can find other
 * cards: there `::` in `{{a:: b}}` is the plugin's, so of the two cards srmd's own instance found one is left, which
 * the review shows and saves through the other instance's parse.
 */
export async function test_a_note_loaded_with_another_instance_is_reloaded_before_its_card_shows(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const host = make_workspace({ 'a.sr.md': '{{a:: b}} and Q:: c\n' })
  await load(host.workspace, ['a.sr.md'])
  assert.deepEqual(get_counts(host.workspace.state.nodes['a.sr.md']), { due: 0, new: 2, later: 0 })

  const md = new MarkdownIt().use(keys)
  srmd_plugin(md, { positions: true })
  const card = await host.workspace.run(async () => {
    host.workspace.use(md)
    return host.workspace.next_card('')
  })
  assert.equal(card.data.html,
    '<p><kbd>a:: b</kbd> and Q: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">c</span></p>')
  assert.deepEqual(get_counts(host.workspace.state.nodes['a.sr.md']), { due: 0, new: 1, later: 0 })
  assert.deepEqual(await host.workspace.run(() => host.workspace.rate(card, Rating.Good)), { status: 'saved' })
  assert.deepEqual(host.writes, [
    ['a.sr.md', '{{a:: b}} and Q:: c[:1]\n\n[:1]: l 20261015121000 0 20261015120000 2.3065 2.11810397 1 1 0\n']
  ])
}

/**
 * An edit is saved when the file still holds the text editing began from, and a saved note gets the edit's cards.
 * When the file changed meanwhile, nothing is written until the edit is saved without a base, overwriting it.
 * Other files are saved without becoming notes.
 */
export async function test_an_edit_is_saved_unless_the_file_changed_since_editing_began(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const host = make_workspace({ 'a.sr.md': 'Q:: one\n', 'readme.md': '# Notes\n' })
  await load(host.workspace, ['a.sr.md'])
  const { workspace } = host

  assert.equal(await workspace.run(() => workspace.save_text('a.sr.md', 'Q:: one\n\nR:: two\n', 'Q:: one\n')), 'saved')
  assert.equal(host.files['a.sr.md'], 'Q:: one\n\nR:: two\n')
  assert.deepEqual(get_counts(workspace.state.nodes['a.sr.md']), { due: 0, new: 2, later: 0 })

  host.files['a.sr.md'] = 'Q:: synced\n'
  assert.equal(await workspace.run(() => workspace.save_text('a.sr.md', 'Q:: mine\n', 'Q:: one\n\nR:: two\n')), 'changed')
  assert.equal(host.files['a.sr.md'], 'Q:: synced\n')
  assert.equal(await workspace.run(() => workspace.save_text('a.sr.md', 'Q:: mine\n', null)), 'saved')
  assert.equal(host.files['a.sr.md'], 'Q:: mine\n')
  assert.equal(workspace.state.nodes['a.sr.md'].version, 'Q:: mine\n')

  assert.equal(await workspace.run(() => workspace.save_text('readme.md', '# Notes\n\nMore.\n', '# Notes\n')), 'saved')
  assert.equal(host.files['readme.md'], '# Notes\n\nMore.\n')
  assert.equal(workspace.state.nodes['readme.md'], undefined)
}

/**
 * Applying changes removes notes, reloads changed ones and adds new ones, then announces notes that gained problems:
 * here a definition no cloze uses. Of the changed notes, only one with a hint is written, the hint resolved. An
 * unreadable note keeps its previous state, and an unreadable new one stays out.
 */
export async function test_applying_changes_removes_reloads_and_adds_notes(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const host = make_workspace({ 'a.sr.md': 'Q:: one\n', 'b.sr.md': 'Q:: two\n', 'c.sr.md': 'Q:: three\n' })
  await load(host.workspace, ['a.sr.md', 'b.sr.md', 'c.sr.md'])
  host.events.length = 0
  delete host.files['a.sr.md']
  host.files['b.sr.md'] = 'Q:: two\n\n[:9]: k 20261014040000 7 20261007120000 8.5 4.2 0 10 1\n'
  host.files['d.sr.md'] = 'Q:: four[:1]\n\n[:1]: 1w\n'
  delete host.files['c.sr.md']

  await host.workspace.run(() => host.workspace.apply(['a.sr.md'], ['b.sr.md', 'c.sr.md', 'd.sr.md', 'e.sr.md']))
  assert.deepEqual(Object.keys(host.workspace.state.nodes).sort(), ['', 'b.sr.md', 'c.sr.md', 'd.sr.md'])
  assert.equal(host.workspace.state.nodes['c.sr.md'].version, 'Q:: three\n')
  assert.deepEqual(host.log, [
    ['warn', 'b.sr.md: Line 3: definition [:9] belongs to no cloze; saving a review removes it.'],
    ['error', 'Could not read c.sr.md; keeping its previous state: No such file: c.sr.md'],
    ['error', 'Skipped e.sr.md: No such file: e.sr.md']
  ])
  assert.deepEqual(host.events, ['refreshed', ['problems', 1]])
  assert.deepEqual(host.writes, [['d.sr.md', 'Q:: four[:1]\n\n[:1]: k 20261022040000\n']])
}

/**
 * A resolved hint that cannot be written is logged, and the note stays loaded with the hint resolved in memory; the
 * next load resolves it again.
 */
export async function test_a_hint_that_cannot_be_written_is_logged(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const host = make_workspace({ 'a.sr.md': 'Q:: one[:1]\n\n[:1]: 7d\n' })
  host.write_error = new Error('Disk is read-only')
  await load(host.workspace, ['a.sr.md'])
  assert.deepEqual(host.log, [['error', 'Unable to save resolved scheduling hints to a.sr.md: Disk is read-only']])
  assert.equal(host.workspace.state.nodes['a.sr.md'].cards[0].state, 'k')
  assert.equal(host.files['a.sr.md'], 'Q:: one[:1]\n\n[:1]: 7d\n')
}

/** Tasks run one at a time in submission order, and a failed task rejects only its own promise. */
export async function test_tasks_run_one_at_a_time_in_order() {
  const { workspace } = make_workspace({})
  const order = []
  let release
  const first = workspace.run(async () => {
    order.push('first started')
    await new Promise(resolve => { release = resolve })
    order.push('first ended')
  })
  const failing = workspace.run(async () => {
    order.push('second')
    throw new Error('failed')
  })
  const third = workspace.run(async () => {
    order.push('third')
    return 3
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(order, ['first started'])
  release()
  await first
  await assert.rejects(failing, /failed/)
  assert.equal(await third, 3)
  assert.deepEqual(order, ['first started', 'first ended', 'second', 'third'])
}

/**
 * Limited tasks start in order, at most the limit at once, and a task finishing frees its slot for the next item: a
 * slow first read does not hold back the items after it.
 */
export async function test_limited_tasks_keep_every_slot_busy() {
  const started = []
  const finish = {}
  const done = each_limited(['slow', 'a', 'b', 'c'], 2, item => new Promise(resolve => {
    started.push(item)
    finish[item] = resolve
  }))
  await settle()
  assert.deepEqual(started, ['slow', 'a'])
  finish.a()
  await settle()
  assert.deepEqual(started, ['slow', 'a', 'b'])
  finish.b()
  await settle()
  assert.deepEqual(started, ['slow', 'a', 'b', 'c'])
  finish.c()
  finish.slow()
  await done
}

// Run every test_ function above as a test named after it.
for (const [name, fn] of Object.entries(tests)) if (name.startsWith('test_')) test(name, fn)
