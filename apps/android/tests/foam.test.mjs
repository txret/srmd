// The Foam adapter (foam.ts): what Foam knows of the folder's files, and the texts its embed plugin reads (foam_fs.ts).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Foam } from '../src/foam.ts'
import { texts } from '../src/foam_fs.ts'
import * as tests from './foam.test.mjs'

/**
 * A file shown with a changed text changes what Foam knows of it and what embeds of it read alike: showing a.md, which
 * embeds b.md, reads b.md; once b.md is shown with a new title, a link to it and an embed of it both have the new text.
 */
export async function test_a_shown_files_new_text_reaches_links_and_embeds_alike() {
  const files = { 'a.md': '# A\n\n![[b]]\n', 'b.md': '# Bee\n' }
  const foam = new Foam(async path => files[path], path => path.endsWith('.md'))
  await foam.set_files(Object.keys(files))
  await foam.prepare('a.md', files['a.md'])
  assert.equal(texts.get('/b.md'), '# Bee\n')
  files['b.md'] = '# Bee two\n'
  await foam.prepare('b.md', files['b.md'])
  await foam.prepare('a.md', files['a.md'])
  assert.equal(texts.get('/b.md'), '# Bee two\n')
  assert.equal(foam.md.render('[[b]]'),
    '<p><a class="foam-note-link" title="Bee two" href="/notes/b.md" data-href="/notes/b.md">Bee two</a></p>\n')
}

/**
 * Every file the app opens as Markdown is one of Foam's notes, whatever its extension: shown, a `.markdown` file links
 * to a note with a custom suffix, and wiki links to either, by name and extension, show their titles.
 */
export async function test_the_apps_markdown_files_are_foams_notes() {
  const files = { 'extra.markdown': '# Extra\n\nSee [[custom.flash]].\n', 'custom.flash': '# Flash\n', 'c.txt': 'text' }
  const foam = new Foam(async path => files[path], path => path.endsWith('.markdown') || path.endsWith('.flash'))
  await foam.set_files(Object.keys(files))
  await foam.prepare('extra.markdown', files['extra.markdown'])
  assert.equal(foam.md.render('[[custom.flash]] [[extra.markdown]]'), '<p>' +
    '<a class="foam-note-link" title="Flash" href="/notes/custom.flash" data-href="/notes/custom.flash">Flash</a> ' +
    '<a class="foam-note-link" title="Extra" href="/notes/extra.markdown" data-href="/notes/extra.markdown">Extra</a></p>\n')
}

// Run every test_ function above as a test named after it.
for (const [name, fn] of Object.entries(tests)) if (name.startsWith('test_')) test(name, fn)
