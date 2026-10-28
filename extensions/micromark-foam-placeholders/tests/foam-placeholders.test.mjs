// Placeholders for Foam's syntax: block anchors are hidden, wiki links and embeds become text naming their target.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { micromark } from 'micromark'
import { gfm, gfmHtml } from 'micromark-extension-gfm'
import { foam_placeholders, foam_placeholders_html } from '../src/index.ts'
import * as tests from './foam-placeholders.test.mjs'

/** Compile Markdown with the placeholders, and GFM for tables. */
function render(source) {
  return micromark(source, { extensions: [gfm(), foam_placeholders()], htmlExtensions: [gfmHtml(), foam_placeholders_html()] })
}

/**
 * A block anchor, `^id` after whitespace or a line ending, is hidden at the end of a text: of a paragraph, also with
 * spaces after it, a heading, a list item, also on the line after it, and a table cell; and alone in a paragraph.
 */
export function test_a_block_anchor_ending_a_text_is_hidden() {
  assert.equal(render('Para ^id  '), '<p>Para </p>')
  assert.equal(render('## Heading ^my-id-2'), '<h2>Heading </h2>')
  assert.equal(render('- item ^id'), '<ul>\n<li>item </li>\n</ul>')
  assert.equal(render('- a\n- b\n^id'), '<ul>\n<li>a</li>\n<li>b\n</li>\n</ul>')
  assert.equal(render('| a ^id |\n| - |'), '<table>\n<thead>\n<tr>\n<th>a </th>\n</tr>\n</thead>\n</table>')
  assert.equal(render('```\ncode\n```\n^id'), '<pre><code>code\n</code></pre>\n<p></p>')
}

/** A block anchor before more text, inside a word, or in code is text. */
export function test_a_block_anchor_elsewhere_is_text() {
  assert.equal(render('a ^id b x^id\n^id more'), '<p>a ^id b x^id\n^id more</p>')
  assert.equal(render('`a ^id`'), '<p><code>a ^id</code></p>')
}

/**
 * A wiki link or embed becomes text naming its target: `label: target`, with later dividers part of the label and an
 * embed's parameters as its label, or `Link to target`. Markup characters are escaped, and in a table cell the
 * escaped divider `\|` divides.
 */
export function test_wiki_links_and_embeds_become_text_naming_their_target() {
  assert.equal(render('[[note]]'), '<p>Link to note</p>')
  assert.equal(render('[[note#Section|the section]]'), '<p>the section: note#Section</p>')
  assert.equal(render('[[a|b|c]]'), '<p>b|c: a</p>')
  assert.equal(render('See ![[chart.png|300]] and ![[other]]'), '<p>See 300: chart.png and Link to other</p>')
  assert.equal(render('[[<b>&|"x"]]'), '<p>&quot;x&quot;: &lt;b&gt;&amp;</p>')
  assert.equal(render('| [[a\\|b]] |\n| - |'), '<table>\n<thead>\n<tr>\n<th>b: a</th>\n</tr>\n</thead>\n</table>')
}

/**
 * Brackets without a visible target, across lines or around a bracket are no wiki link; nor is one escaped or in
 * code. Images and tags keep their Markdown meaning.
 */
export function test_other_brackets_images_and_tags_keep_their_markdown_meaning() {
  assert.equal(render('[[]] [[ |x]] [[a]b]] [[a\nb]]'), '<p>[[]] [[ |x]] [[a]b]] [[a\nb]]</p>')
  assert.equal(render('\\[[a]] `[[a]]`'), '<p>[[a]] <code>[[a]]</code></p>')
  assert.equal(render('![alt](src)'), '<p><img src="src" alt="alt" /></p>')
  assert.equal(render('#tag and #area/sub'), '<p>#tag and #area/sub</p>')
}

// Run every test_ function above as a test named after it.
for (const [name, fn] of Object.entries(tests)) if (name.startsWith('test_')) test(name, fn)
