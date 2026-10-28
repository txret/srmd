// The Markdown preview plugin (ARCHITECTURE.md, "Markdown preview"): notes rendered by VS Code's own markdown-it,
// as the mocked VS Code of host.mjs activates the extension.
import assert from 'node:assert/strict'
import { test } from 'node:test'
// The Markdown preview's renderer; VS Code bundles its own copy of the same major version.
import MarkdownIt from 'markdown-it'
import { start_host, uri, wait_until } from './host.mjs'
import * as tests from './preview.test.mjs'

/** Like Foam's wiki links: another extension's markdown-it syntax, which a note's preview keeps. */
const wiki_links = md => md.inline.ruler.before('link', 'wiki_link', (state, silent) => {
  const match = /^\[\[([^\]]+)\]\]/.exec(state.src.slice(state.pos))
  if (!match) return false
  if (!silent) state.push('html_inline', '', 0).content = `<a class="wiki" href="${match[1]}.md">${match[1]}</a>`
  state.pos += match[0].length
  return true
})
/** Like VS Code's own source map plugin, added after the extensions': blocks name their line for scroll sync. */
const source_lines = md => md.core.ruler.push('source_lines', state => {
  for (const token of state.tokens) if (token.map && token.type !== 'inline') token.attrSet('data-line', String(token.map[0]))
})
/**
 * Preview a file as VS Code's Markdown preview does: parse its text without naming the document, then render the
 * tokens with the document in the environment.
 */
const preview = (md, path, text) => md.renderer.render(md.parse(text, { currentDocument: undefined }), md.options, { currentDocument: uri(path) })

/**
 * The Markdown preview renders a note with markdown-it and its plugins, every cloze marked as in the review.
 * markdown-it is set up as VS Code sets it up: HTML and links on, the extensions' plugins, then VS Code's own.
 * The note keeps the other extension's wiki link and the line of each block, the review's cloze elements replace
 * the srmd markers, and its references and definitions disappear. Another file, or text rendered without a
 * document, is plain Markdown.
 */
export async function test_a_note_renders_with_markdown_it_and_its_plugins(t) {
  const source = `
# Physiology

The heart has:: four chambers, see [[Heart]][:1]

Source:: https://example.com/heart

The layers::

- Endocardium
- Myocardium

> Quoted ::>_explicit_<:: answer

[:1]: k 20261016040000 1 20261015120000 2.3065 2.11810397 0 1 0
`.slice(1)
  const host = await start_host(t, source, {})
  const md = new MarkdownIt({ html: true, linkify: true }).use(wiki_links)
  assert.equal(host.extend_markdown_it(md), md)
  md.use(source_lines)
  // The link at the end of the second cloze stops at its end.
  assert.equal(preview(md, '/workspace/topic/a.sr.md', source), `
<h1 data-line="0">Physiology</h1>
<p data-line="2">The heart has: <span class="cloze" data-ordinal="1" data-card="[:1]: k 20261016040000 1 20261015120000 2.3065 2.11810397 0 1 0">four chambers, see <a class="wiki" href="Heart.md">Heart</a></span></p>
<p data-line="4">Source: <span class="cloze" data-ordinal="2" data-card="[:-2]: n 0 0 0 0 0 0 0 0"><a href="https://example.com/heart">https://example.com/heart</a></span></p>
<p data-line="6">The layers:</p>
<div class="cloze" data-ordinal="3" data-card="[:-3]: n 0 0 0 0 0 0 0 0">
<ul data-line="8">
<li data-line="8">Endocardium</li>
<li data-line="9">Myocardium</li>
</ul>
</div>
<blockquote data-line="11">
<p data-line="11">Quoted <span class="cloze" data-ordinal="4" data-card="[:-4]: n 0 0 0 0 0 0 0 0"><em>explicit</em></span> answer</p>
</blockquote>
`.slice(1))
  assert.equal(preview(md, '/workspace/topic/b.md', 'Q:: one[:1]'), '<p data-line="0">Q:: one[:1]</p>\n')
  assert.equal(md.render('Q:: one[:1]'), '<p data-line="0">Q:: one[:1]</p>\n')
}

/**
 * A note's preview keeps its block structure where srmd syntax stood: lists stay tight, lines stay.
 * The reference line in the first item and the lone markers leave its list tight and its lines numbered as in
 * the note; the reference line after the second list ends that list as in the review. Paragraphs holding only
 * explicit markers disappear, and the explicit block cloze holds the blocks up to its closer.
 */
export async function test_a_note_keeps_its_block_structure_where_srmd_syntax_stood(t) {
  const source = `
- Code:::
  \`\`\`
  x
  \`\`\`
  [:1]
- next

List::

- a
- b
[:2]

Several blocks ::>

First.

<::

| A       | B       |
|---------|---------|
| ::: one | ::; two |

[:1]: k 20261016040000 1 20261015120000 2.3065 2.11810397 0 1 0
`.slice(1)
  const host = await start_host(t, source, {})
  const md = host.extend_markdown_it(new MarkdownIt()).use(source_lines)
  assert.equal(preview(md, '/workspace/topic/a.sr.md', source), `
<ul data-line="0">
<li data-line="0">Code:
<div class="cloze" data-ordinal="1" data-card="[:1]: k 20261016040000 1 20261015120000 2.3065 2.11810397 0 1 0">
<pre><code data-line="1">x
</code></pre>
</div>
</li>
<li data-line="5">next</li>
</ul>
<p data-line="7">List:</p>
<div class="cloze" data-ordinal="2" data-card="[:-2]: n 0 0 0 0 0 0 0 0">
<ul data-line="9">
<li data-line="9">a</li>
<li data-line="10">b</li>
</ul>
</div>
<p data-line="13">Several blocks </p>
<div class="cloze" data-ordinal="3" data-card="[:-3]: n 0 0 0 0 0 0 0 0">
<p data-line="15">First.</p>
</div>
<table data-line="19">
<thead data-line="19">
<tr data-line="19">
<th>A</th>
<th>B</th>
</tr>
</thead>
<tbody data-line="21">
<tr data-line="21">
<td>: <span class="cloze" data-ordinal="4" data-card="[:-4]: n 0 0 0 0 0 0 0 0">one</span></td>
<td>: <span class="cloze" data-ordinal="4" data-card="[:-4]: n 0 0 0 0 0 0 0 0">two</span></td>
</tr>
</tbody>
</table>
`.slice(1))
}

/**
 * The Markdown preview renders notes while srmd is on, by the current suffixes and extensions, and redraws on
 * changes.
 * VS Code caches a document's tokens and renders them again at each preview update, so one parse renders with
 * the settings of each render. Every settings change asks VS Code to redraw the open previews. With the Foam
 * placeholders, srmd reads a wiki link as one unit, so the colons in it open no cloze.
 */
export async function test_notes_render_while_srmd_is_on_with_the_current_settings(t) {
  const source = 'Q:: [[note:: x]]'
  const host = await start_host(t, source, { enabled: false })
  const md = host.extend_markdown_it(new MarkdownIt())
  const tokens = md.parse(source, { currentDocument: undefined })
  const render = path => md.renderer.render(tokens, md.options, { currentDocument: uri(path) })
  assert.equal(render('/workspace/topic/a.sr.md'), '<p>Q:: [[note:: x]]</p>\n')
  assert.equal(host.preview_refreshes, 0)

  host.change_settings({ enabled: true })
  assert.equal(host.preview_refreshes, 1)
  assert.equal(render('/workspace/topic/a.sr.md'), `
<p>Q: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">[[note: <span class="cloze" data-ordinal="2" data-card="[:-2]: n 0 0 0 0 0 0 0 0">x]]</span></span></p>
`.slice(1))
  await wait_until(() => host.state.nodes['topic/a.sr.md'])

  host.change_settings({ suffixes: ['.cards.md'], extensions: ['foam-placeholders'] })
  assert.equal(host.preview_refreshes, 2)
  assert.equal(render('/workspace/topic/a.sr.md'), '<p>Q:: [[note:: x]]</p>\n')
  assert.equal(render('/workspace/topic/a.cards.md'), `
<p>Q: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">[[note:: x]]</span></p>
`.slice(1))
  await wait_until(() => !host.state.nodes['topic/a.sr.md'])
}

// Run every test_ function above as a test named after it.
for (const [name, fn] of Object.entries(tests)) if (name.startsWith('test_')) test(name, fn)
