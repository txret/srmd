// The parts of the views that need no browser: links, rendering, settings, gestures, editor marks and changes.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ChangeSet, Text } from '@codemirror/state'
import { file_html, folder_url, link_target } from '../src/note_view.ts'
import { app_settings, parse_list } from '../src/settings.ts'
import { settles_open, swipe_axis } from '../src/gestures.ts'
import { line_changes, srmd_marks } from '../src/editor.ts'
import { row_html } from '../src/tree_view.ts'
import * as tests from './views.test.mjs'

/**
 * Links resolve against the file's folder and absolute paths against the notes folder; above it they lead nowhere. A
 * fragment alone names an element of the file. Web, mail and phone links open outside the app; other schemes lead
 * nowhere.
 */
export function test_links_lead_to_files_elements_or_urls() {
  assert.deepEqual(link_target('other.md', 'topic/a.sr.md'), { kind: 'file', path: 'topic/other.md', fragment: '' })
  assert.deepEqual(link_target('../b%20c.md#Heart%20rate', 'topic/a.sr.md'), { kind: 'file', path: 'b c.md', fragment: 'Heart rate' })
  assert.deepEqual(link_target('/x/y.md', 'topic/a.sr.md'), { kind: 'file', path: 'x/y.md', fragment: '' })
  assert.equal(link_target('../../up.md', 'topic/a.sr.md'), null)
  assert.equal(link_target('//example.com/a.md', 'topic/a.sr.md'), null)
  assert.deepEqual(link_target('#user-content-fn-1', 'a.sr.md'), { kind: 'fragment', id: 'user-content-fn-1' })
  assert.deepEqual(link_target('https://example.com/a?b#c', 'a.sr.md'), { kind: 'url', url: 'https://example.com/a?b#c' })
  assert.deepEqual(link_target('mailto:me@example.com', 'a.sr.md'), { kind: 'url', url: 'mailto:me@example.com' })
  assert.equal(link_target('javascript:alert(1)', 'a.sr.md'), null)
  assert.equal(link_target('file:///etc/passwd', 'a.sr.md'), null)
  assert.equal(folder_url('https://appassets.androidplatform.net', 'topic/sub folder/a.sr.md'), 'https://appassets.androidplatform.net/notes/topic/sub%20folder/')
  assert.equal(folder_url('https://appassets.androidplatform.net', 'a.sr.md'), 'https://appassets.androidplatform.net/notes/')
}

/** Markdown and notes render with srmd, every cloze in the HTML; plain text is escaped and preformatted; raw HTML is escaped. */
export function test_files_render_by_kind() {
  assert.equal(file_html('Q:: answer <b>x</b>', 'note', []), '<p>Q: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">answer &lt;b&gt;x&lt;/b&gt;</span></p>')
  assert.equal(file_html('# Title\n\nA ::>cloze<:: here', 'markdown', []), '<h1>Title</h1>\n<p>A <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">cloze</span> here</p>')
  assert.equal(file_html('a < b\n  & c', 'text', []), '<pre class="plain">a &lt; b\n  &amp; c</pre>')
}

/**
 * Settings fields take lists separated by commas or spaces; extensions get a dot and lowercase. Stored settings fill
 * in defaults, and invalid stored lists are reported and replaced.
 */
export function test_settings_lists_and_defaults() {
  assert.deepEqual(parse_list(' md, .Markdown  txt,md ', 'extensions'), ['.md', '.markdown', '.txt'])
  assert.deepEqual(parse_list('.*, node_modules', 'names'), ['.*', 'node_modules'])
  const invalid = []
  const settings = app_settings({ markdown: ['.MD'], text: ['.txt'], skip: [''], suffixes: ['.cards.md'] }, name => invalid.push(name))
  assert.deepEqual(invalid, ['markdown', 'skip'])
  assert.deepEqual(settings.types.markdown, ['.md', '.markdown', '.mdown', '.mkd', '.mkdn', '.mdwn', '.mdtxt', '.mdtext'])
  assert.deepEqual(settings.types.text, ['.txt'])
  assert.deepEqual(settings.skip, ['.*', 'node_modules'])
  assert.deepEqual(settings.suffixes, ['.cards.md'])
}

/**
 * A touch counts as sideways only once it moved 12 px, clearly more sideways than up or down; a drag of the drawer ends
 * open past half its width, or by the direction of a fling.
 */
export function test_swipes_need_distance_and_a_clear_direction() {
  assert.equal(swipe_axis(8, 3), null)
  assert.equal(swipe_axis(20, 5), 'x')
  assert.equal(swipe_axis(-20, 12), 'x')
  assert.equal(swipe_axis(20, 15), 'y')
  assert.equal(swipe_axis(2, -30), 'y')
  assert.equal(settles_open(200, 300, 0), true)
  assert.equal(settles_open(100, 300, 0.2), false)
  assert.equal(settles_open(100, 300, 0.8), true)
  assert.equal(settles_open(250, 300, -0.9), false)
}

/**
 * The editor marks srmd's cloze markers, cloze contents and card metadata at the parser's token offsets: an implicit
 * opener's token includes its space, and the first cloze includes its card's reference.
 */
export function test_the_editor_marks_srmd_syntax() {
  const text = 'Q:: answer[:1]\n\n[:1]: k 20261014040000 7 20261007120000 8.5 4.2 0 10 1'
  const marks = []
  const cursor = srmd_marks(text, []).iter()
  for (; cursor.value; cursor.next()) marks.push([text.slice(cursor.from, cursor.to), cursor.value.spec.class])
  assert.deepEqual(marks, [
    [':: ', 'cm-srmd-marker'],
    ['answer[:1]', 'cm-srmd-cloze'],
    ['[:1]', 'cm-srmd-metadata'],
    ['[:1]: k 20261014040000 7 20261007120000 8.5 4.2 0 10 1', 'cm-srmd-metadata']
  ])
}

/** The text CodeMirror holds after applying changes to text. */
const apply_changes = (text, changes) => ChangeSet.of(changes, text.length).apply(Text.of(text.split('\n'))).toString()

/**
 * Formatting changes the editor's text line by line: lines both texts have in the same order stay, so the cursor on
 * them stays too. Removed lines go with their line break, inserted ones come with theirs, and at the end of the text
 * the line break before them; lines without any in common are replaced.
 */
export function test_line_changes_keep_the_lines_both_texts_have() {
  const text = 'Q::\n* a\n* b\n\n\n[:1]: k'
  const formatted = 'Q::\n\n- a\n- b\n\n[:1]: k\n'
  assert.deepEqual(line_changes(text, formatted), [{ from: 4, to: 12 }, { from: 13, insert: '- a\n- b\n' }, { from: 21, insert: '\n' }])
  assert.equal(apply_changes(text, line_changes(text, formatted)), formatted)
  assert.deepEqual(line_changes('a\nx', 'a'), [{ from: 1, to: 3 }])
  assert.equal(apply_changes('a\nx', line_changes('a\nx', 'a')), 'a')
  assert.deepEqual(line_changes('b', 'a\nb'), [{ from: 0, insert: 'a\n' }])
  assert.deepEqual(line_changes('a\nx\ny', 'b'), [{ from: 0, to: 5, insert: 'b' }])
  assert.deepEqual(line_changes('same\n', 'same\n'), [])
}

/** A tree row shows its name, counts with a warning for problems, text matches, and Review when cards are due or new. */
export function test_tree_rows_render_counts_and_review() {
  assert.equal(row_html({ path: 'topic/a.sr.md', name: 'a.sr.md', depth: 2, kind: 'note', expanded: false, counts: { due: 1, new: 2, later: 3 }, problems: true, matches: 4 }, true),
    '<div class="row note selected" role="treeitem" data-path="topic/a.sr.md" style="--depth: 2"><span class="twist"></span><span class="name">a.sr.md</span>' +
    '<span class="matches">4</span><span class="counts">⚠ d1 • n2 • l3</span><button type="button" class="review" aria-label="Review a.sr.md">' +
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 5.5v13l10.5-6.5z"/></svg></button></div>')
  assert.equal(row_html({ path: 'x & y', name: 'x & y', depth: 1, kind: 'folder', expanded: true, counts: { due: 0, new: 0, later: 5 }, problems: false }, false),
    '<div class="row folder expanded" role="treeitem" aria-expanded="true" data-path="x &amp; y" style="--depth: 1"><span class="twist">' +
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></span>' +
    '<span class="name">x &amp; y</span><span class="counts">d0 • n0 • l5</span></div>')
}

// Run every test_ function above as a test named after it.
for (const [name, fn] of Object.entries(tests)) if (name.startsWith('test_')) test(name, fn)
