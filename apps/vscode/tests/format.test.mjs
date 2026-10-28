// Formatting notes (ARCHITECTURE.md, "Formatting"): Format Document with the shared format(), in the mocked VS Code of
// host.mjs.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Position, Range, TextEdit, start_host } from './host.mjs'
import * as tests from './format.test.mjs'

/**
 * While srmd is on, Format Document formats the files with a note suffix: one edit replaces a note's text with the
 * formatted text, and a formatted note gets none. Other files have no formatter of srmd's.
 */
export async function test_format_document_formats_notes(t) {
  const host = await start_host(t, {
    'topic/a.sr.md': `
Question::
* one
* two
[:1]
`.slice(1),
    'topic/b.sr.md': `
Formatted:: already
`.slice(1),
    'readme.md': `
* not a note
`.slice(1)
  }, {})
  assert.deepEqual(host.formatter_selectors, [[{ pattern: '**/*.sr.md' }]])
  assert.deepEqual(host.format_document('/workspace/topic/a.sr.md'), [new TextEdit(new Range(new Position(0, 0), new Position(4, 0)), `
Question::

- one
- two
[:1]
`.slice(1))])
  assert.deepEqual(host.format_document('/workspace/topic/b.sr.md'), [])
  assert.equal(host.format_document('/workspace/readme.md'), null)
}

/**
 * The formatter follows the settings: the suffixes, also with glob characters, which stand in brackets, and srmd
 * turned off and on again.
 */
export async function test_the_formatter_follows_the_settings(t) {
  const host = await start_host(t, {}, {})
  host.change_settings({ suffixes: ['.cards.md', '.{x}.md'] })
  assert.deepEqual(host.formatter_selectors, [[{ pattern: '**/*.cards.md' }, { pattern: '**/*.[{]x[}].md' }]])
  host.change_settings({ enabled: false })
  assert.deepEqual(host.formatter_selectors, [])
  host.change_settings({ enabled: true })
  assert.deepEqual(host.formatter_selectors, [[{ pattern: '**/*.cards.md' }, { pattern: '**/*.[{]x[}].md' }]])
}

/**
 * The formatting settings, `srmd.format.*`, apply at the next Format Document; changing only them reloads nothing, so
 * Markdown previews are not redrawn, as they are when another setting changes too.
 */
export async function test_formatting_settings_apply_at_the_next_format(t) {
  const host = await start_host(t, `
Question::
- one
- two
`.slice(1), {})
  const refreshes = host.preview_refreshes
  host.change_settings({ 'format.bullet': '*', 'format.numbering': 'repeat' })
  assert.equal(host.preview_refreshes, refreshes)
  assert.deepEqual(host.format_document('/workspace/topic/a.sr.md'), [new TextEdit(new Range(new Position(0, 0), new Position(3, 0)), `
Question::

* one
* two
`.slice(1))])
  host.change_settings({ 'format.bullet': '+', rollover: '05:00' })
  assert.equal(host.preview_refreshes, refreshes + 1)
}

/**
 * A note whose formatted text would render differently gets no edit, as that is a defect of the formatter; a warning
 * and the log say so. A table row with more cells than its header would widen the header.
 */
export async function test_a_note_that_would_render_differently_is_left_unformatted(t) {
  const host = await start_host(t, `
| a |
|---|
| b | extra |
`.slice(1), {})
  assert.deepEqual(host.format_document('/workspace/topic/a.sr.md'), [])
  const message = 'Formatting topic/a.sr.md would change how it renders, so it was left unchanged.'
  assert.deepEqual(host.warnings, [[message]])
  assert.deepEqual(host.log.filter(([level]) => level === 'warn'), [['warn', message]])
}

// Run every test_ function above as a test named after it.
for (const [name, fn] of Object.entries(tests)) if (name.startsWith('test_')) test(name, fn)
