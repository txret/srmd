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
  const foam = new Foam(async path => files[path], path => path.endsWith('.md'), path => files[path])
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
  const foam = new Foam(async path => files[path], path => path.endsWith('.markdown') || path.endsWith('.flash'), path => files[path])
  await foam.set_files(Object.keys(files))
  await foam.prepare('extra.markdown', files['extra.markdown'])
  assert.equal(foam.md.render('[[custom.flash]] [[extra.markdown]]'), '<p>' +
    '<a class="foam-note-link" title="Flash" href="/notes/custom.flash" data-href="/notes/custom.flash">Flash</a> ' +
    '<a class="foam-note-link" title="Extra" href="/notes/extra.markdown" data-href="/notes/extra.markdown">Extra</a></p>\n')
}

/**
 * A text Foam keeps for embeds is used only while it is the file's current one: after part.md changed without being
 * shown, as when the app saved an edit of it, showing host.md, which embeds it, reads it again. While it is unchanged
 * it is not read again.
 */
export async function test_an_embedded_file_changed_since_it_was_read_is_read_again() {
  const files = { 'host.md': '# Host\n\n![[part]]\n', 'part.md': '# Part\n' }
  const reads = []
  const read = async path => {
    reads.push(path)
    return files[path]
  }
  const foam = new Foam(read, path => path.endsWith('.md'), path => files[path])
  await foam.set_files(Object.keys(files))
  await foam.prepare('host.md', files['host.md'])
  await foam.prepare('host.md', files['host.md'])
  assert.deepEqual(reads, ['part.md'])
  assert.equal(texts.get('/part.md'), '# Part\n')

  files['part.md'] = '# Part two\n'
  await foam.prepare('host.md', files['host.md'])
  assert.deepEqual(reads, ['part.md', 'part.md'])
  assert.equal(texts.get('/part.md'), '# Part two\n')
}

/**
 * A file without wiki links needs nothing read before it renders, so Foam does not parse it or keep its text: Foam
 * knows it by its name, as before it was shown.
 */
export async function test_a_file_without_wiki_links_is_not_parsed() {
  const files = { 'plain.md': '# Plain title\n\nQ:: answer\n' }
  const foam = new Foam(async path => files[path], path => path.endsWith('.md'), path => files[path])
  await foam.set_files(Object.keys(files))
  await foam.prepare('plain.md', files['plain.md'])
  assert.equal(texts.has('/plain.md'), false)
  assert.equal(foam.md.render('[[plain]]'),
    '<p><a class="foam-note-link" title="plain" href="/notes/plain.md" data-href="/notes/plain.md">plain</a></p>\n')
}

// Run every test_ function above as a test named after it.
for (const [name, fn] of Object.entries(tests)) if (name.startsWith('test_')) test(name, fn)
