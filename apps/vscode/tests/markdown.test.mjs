// The markdown-it instance reviews parse and render notes with (markdown.ts): composed of the installed extensions'
// plugins as VS Code composes its Markdown preview's, in the mocked VS Code of host.mjs.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { markdown_extension, start_host, wait_until } from './host.mjs'
import * as tests from './markdown.test.mjs'

/** The note's HTML in a card's markup, between the content div's tags. */
const note_html = markup => markup.split('<div class="content">')[1].split('</div>\n  <div class="footer">')[0]

/** Another extension's syntax read while parsing: `{{text}}` renders as `<kbd>text</kbd>`, so `::` inside it is no marker. */
const keys = md => md.inline.ruler.before('emphasis', 'keys', (state, silent) => {
  /* Take `{{` up to `}}` on the line. */
  const match = /^\{\{([^}\n]*)\}\}/.exec(state.src.slice(state.pos))
  if (!match) return false
  if (!silent) state.push('html_inline', '', 0).content = `<kbd>${md.utils.escapeHtml(match[1])}</kbd>`
  state.pos += match[0].length
  return true
})

/**
 * Another extension's syntax found once inline parsing is done, as Foam finds its wiki links: `[[note|label]]` in a text
 * becomes a link to `topic/note.md` with the label, written as Foam writes it.
 */
const wiki_links = md => md.core.ruler.push('wiki_links', state => {
  /* Split every text token at its wiki links, each of which becomes HTML, as Foam's plugin replaces them. */
  for (const token of state.tokens.filter(token => token.type === 'inline')) {
    token.children = token.children.flatMap(child => child.type !== 'text' ? [child]
      : child.content.split(/(\[\[[^\]|]+\|[^\]]+\]\])/).filter(part => part).map(part => {
        const link = /^\[\[([^\]|]+)\|([^\]]+)\]\]$/.exec(part)
        const piece = new state.Token(link ? 'html_inline' : 'text', '', 0)
        piece.content = link
          ? `<a class="foam-note-link" title="${link[1]}" href="/topic/${link[1]}.md" data-href="/topic/${link[1]}.md">${link[2]}</a>`
          : part
        return piece
      }))
  }
})

/**
 * Like Foam's embeds, which Foam renders through the instance it extends: `![[name]]` shows the text of the file by that
 * name, rendered in an environment of its own, which names no note.
 */
const embeds = texts => md => {
  md.inline.ruler.before('link', 'embed', (state, silent) => {
    const match = /^!\[\[([^\]]+)\]\]/.exec(state.src.slice(state.pos))
    if (!match) return false
    if (!silent) state.push('embed', '', 0).content = match[1]
    state.pos += match[0].length
    return true
  })
  md.renderer.rules.embed = (tokens, index) => `<div class="embed">${md.render(texts[tokens[index].content])}</div>`
}

/**
 * Reviews parse and render notes with markdown-it composed of the plugins of every installed extension whose manifest
 * declares `markdown.markdownItPlugins`, srmd's among them, in the order of their ids, as VS Code promises none: each
 * extension is activated, and its extendMarkdownIt() gets the instance the one before returned. The card shows both
 * extensions' syntax in the cloze, and its rating is saved through the same parse.
 */
export async function test_reviews_compose_every_extensions_markdown_it_plugins_in_id_order(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  /** The extension ids in the order their hooks ran, with the instance each got. */
  const calls = []
  /** The instance the first hook returned in place of the one it got. */
  let returned
  const host = await start_host(t, 'Press:: {{Ctrl}} on [[note|the note]]\n', {}, 'en', [
    markdown_extension('zeta.links', md => {
      calls.push(['zeta.links', md])
      wiki_links(md)
    }),
    markdown_extension('alpha.keys', md => {
      calls.push(['alpha.keys', md])
      keys(md)
      returned = Object.create(md)
      return returned
    })
  ])
  const review = host.review()
  await wait_until(() => host.panel?.document)
  assert.equal(note_html(host.panel.cards[0].markup), `
<p>Press: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0"><kbd>Ctrl</kbd> on <a class="foam-note-link" title="note" href="/topic/note.md" data-href="/topic/note.md">the note</a></span></p>`.slice(1))
  assert.deepEqual(host.activations, ['alpha.keys', 'zeta.links'])
  assert.deepEqual(calls.map(([id]) => id), ['alpha.keys', 'zeta.links'])
  assert.equal(calls[1][1], returned)

  host.panel.reply('good')
  await wait_until(() => host.files.get('/workspace/topic/a.sr.md').mtime === 2)
  assert.equal(host.files.get('/workspace/topic/a.sr.md').text, `
Press:: {{Ctrl}} on [[note|the note]][:1]

[:1]: l 20261015121000 0 20261015120000 2.3065 2.11810397 1 1 0
`.slice(1))
  host.panel.dispose()
  await review
}

/**
 * srmd's own plugin, which reviews add with `review: true`, shows a note another extension embeds through the instance
 * as Foam does, with its clozes with ordinal 0 and no card, as it is not the note reviewed: only the note's own cloze is
 * the card's.
 */
export async function test_a_note_embedded_in_a_review_shows_its_clozes_with_ordinal_0(t) {
  const texts = { b: 'B:: honey[:1]\n\n[:1]: k 20261016040000 1 20261015120000 2.3 2.1 0 1 0\n' }
  const host = await start_host(t, 'Q:: one\n\n![[b]]\n', {}, 'en', [markdown_extension('foam.foam-vscode', embeds(texts))])
  const review = host.review()
  await wait_until(() => host.panel?.document)
  assert.equal(note_html(host.panel.cards[0].markup), `
<p>Q: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">one</span></p>
<p><div class="embed"><p>B: <span class="cloze" data-ordinal="0">honey</span></p>
</div></p>`.slice(1))
  assert.deepEqual(host.panel.document.active_ordinals(), [1])
  host.panel.dispose()
  await review
}

/**
 * An extension that cannot be activated, whose extendMarkdownIt() throws, or which returns no markdown-it instance is
 * left out of reviews: each is logged, the user is told once and offered the log, and the others' syntax still shows.
 */
export async function test_extensions_failing_to_extend_reviews_are_logged_announced_and_left_out(t) {
  const host = await start_host(t, 'Q:: {{Ctrl}}\n', {}, 'en', [
    markdown_extension('good.keys', keys),
    markdown_extension('bad.result', () => 'markdown'),
    markdown_extension('bad.hook', () => { throw new Error('Rule conflict') }),
    markdown_extension('bad.activation', keys, new Error('No workspace'))
  ])
  const review = host.review()
  await wait_until(() => host.panel?.document)
  assert.equal(note_html(host.panel.cards[0].markup),
    '<p>Q: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0"><kbd>Ctrl</kbd></span></p>')
  assert.deepEqual(host.log, [
    ['error', 'Reviews show notes without the Markdown syntax of bad.activation, which could not be activated: No workspace'],
    ['error', 'Reviews show notes without the Markdown syntax of bad.hook, whose markdown-it plugin failed: Rule conflict'],
    ['error', 'Reviews show notes without the Markdown syntax of bad.result, whose markdown-it plugin failed: its extendMarkdownIt() returned no markdown-it instance']
  ])
  assert.deepEqual(host.warnings, [['Markdown plugins left out of reviews: 3. Reviews show notes without their syntax.', 'Show Log']])
  host.panel.dispose()
  await review
}

/**
 * Reviews compose their markdown-it when the first card needs it, so loading the notes activates no other extension,
 * and compose it anew once extensions change, which the next card shows: here the second card, after an extension was
 * installed while the first was shown.
 */
export async function test_reviews_compose_markdown_it_when_first_needed_and_anew_after_extensions_change(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const host = await start_host(t, 'A:: {{Ctrl}}\n\nB:: [[note|the note]]\n', {}, 'en', [markdown_extension('alpha.keys', keys)])
  assert.deepEqual(host.activations, [])
  const review = host.review()
  await wait_until(() => host.panel?.document)
  assert.deepEqual(host.activations, ['alpha.keys'])
  assert.deepEqual(host.panel.document.active_ordinals(), [1])

  host.install(markdown_extension('zeta.links', wiki_links))
  host.panel.reply('good')
  await wait_until(() => host.panel.cards.length === 2)
  assert.deepEqual(host.activations, ['alpha.keys', 'zeta.links'])
  assert.equal(host.panel.cards[1].ordinal, 2)
  assert.equal(note_html(host.panel.cards[1].markup), `
<p>A: <span class="cloze" data-ordinal="1" data-card="[:1]: l 20261015121000 0 20261015120000 2.3065 2.11810397 1 1 0"><kbd>Ctrl</kbd></span></p>
<p>B: <span class="cloze" data-ordinal="2" data-card="[:-2]: n 0 0 0 0 0 0 0 0"><a class="foam-note-link" title="note" href="/topic/note.md" data-href="/topic/note.md">the note</a></span></p>`.slice(1))
  host.panel.dispose()
  await review
}

/**
 * Reviews render notes with the options VS Code's Markdown preview starts from and takes from its settings: raw HTML,
 * links only with a scheme, and here `markdown.preview.breaks` and `markdown.preview.typographer`, so a line break
 * shows and quotes and dashes are typographic.
 */
export async function test_reviews_take_the_previews_options_and_settings(t) {
  const host = await start_host(t, 'Q:: say "quoted" -- <b>bold</b>\nwww.example.com and https://example.com\n', {
    'markdown.preview.breaks': true, 'markdown.preview.typographer': true
  })
  const review = host.review()
  await wait_until(() => host.panel?.document)
  assert.equal(note_html(host.panel.cards[0].markup), `
<p>Q: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">say “quoted” – <b>bold</b><br>
www.example.com and <a href="https://example.com">https://example.com</a></span></p>`.slice(1))
  host.panel.dispose()
  await review
}

// Run every test_ function above as a test named after it.
for (const [name, fn] of Object.entries(tests)) if (name.startsWith('test_')) test(name, fn)
