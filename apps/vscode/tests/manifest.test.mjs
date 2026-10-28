// The extension manifest (package.json and its texts): the views, menus, commands and contributions the host relies on.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import * as tests from './manifest.test.mjs'

/**
 * The manifest adds the srmd view to the Explorer while srmd is on, and binds Enter and Ctrl+Enter only inside it.
 * Check the view id and keybindings the host registers against, including the when clauses.
 */
export function test_the_view_shows_while_srmd_is_on_and_binds_enter_inside_it() {
  const { contributes } = JSON.parse(readFileSync(`${import.meta.dirname}/../package.json`, 'utf8'))
  assert.deepEqual(contributes.views, {
    explorer: [{ id: 'srmd.notes', name: '%view.notes%', when: 'workspaceFolderCount > 0 && config.srmd.enabled' }]
  })
  // The view's title is translated: Flashcards in English.
  assert.equal(JSON.parse(readFileSync(`${import.meta.dirname}/../package.nls.json`, 'utf8'))['view.notes'], 'Flashcards')
  const in_view = 'focusedView == srmd.notes && listFocus && !inputFocus'
  assert.deepEqual(contributes.keybindings, [
    { command: 'srmd.notes.review', key: 'enter', when: in_view },
    { command: 'srmd.notes.edit', key: 'ctrl+enter', mac: 'cmd+enter', when: in_view }
  ])
}

/**
 * Rows offer Review on every row and Edit on notes, as buttons and menu items; the review tab offers Show Note.
 * Row menus select on the rows' context values; the review tab is recognized by its webview type.
 */
export function test_rows_offer_review_and_edit_and_the_review_tab_show_note() {
  const { contributes } = JSON.parse(readFileSync(`${import.meta.dirname}/../package.json`, 'utf8'))
  assert.deepEqual(contributes.menus['view/item/context'], [
    { command: 'srmd.notes.review', when: 'view == srmd.notes', group: 'inline@1' },
    { command: 'srmd.notes.edit', when: 'view == srmd.notes && viewItem == note', group: 'inline@2' },
    { command: 'srmd.notes.review', when: 'view == srmd.notes', group: 'navigation@1' },
    { command: 'srmd.notes.edit', when: 'view == srmd.notes && viewItem == note', group: 'navigation@2' },
    { command: 'srmd.notes.reveal', when: 'view == srmd.notes', group: 'navigation@3' }
  ])
  const in_review = "activeWebviewPanelId == 'srmdReviewer'"
  assert.deepEqual(contributes.menus['editor/title'], [{ command: 'srmd.showNote', when: in_review, group: 'navigation' }])
  assert.deepEqual(contributes.menus['editor/title/context'], [{ command: 'srmd.showNote', when: in_review }])
  assert.deepEqual(contributes.menus['webview/context'], [{ command: 'srmd.showNote', when: "webviewId == 'srmdReviewer'" }])
  const texts = JSON.parse(readFileSync(`${import.meta.dirname}/../package.nls.json`, 'utf8'))
  assert.deepEqual(['command.notes.review', 'command.notes.edit', 'command.notes.reveal', 'command.showNote'].map(key => texts[key]),
    ['Review', 'Edit', 'Reveal in Explorer', 'srmd: Show Note'])
}

/**
 * Explorer Review contribution uses exact resource membership and a prefixed context-menu title.
 * Check the manifest connects the tested command and context key to the native Explorer; menus show only the title.
 */
export function test_explorer_review_shows_for_review_resources_with_a_prefixed_title() {
  const { contributes } = JSON.parse(readFileSync(`${import.meta.dirname}/../package.json`, 'utf8'))
  assert.deepEqual(contributes.menus['explorer/context'], [{
    command: 'srmd.review', when: 'resource in srmd.reviewResources', group: 'navigation@10'
  }])
  // The command's title placeholder is checked with the other commands below.
  assert.equal(JSON.parse(readFileSync(`${import.meta.dirname}/../package.nls.json`, 'utf8'))['command.review'], 'srmd: Review')
}

/**
 * The manifest offers Turn On while off, and Turn Off and Review while on; the toggle is for the status bar.
 * The setting defaults to off, so the palette's on/off commands and Review follow it through the same key.
 */
export function test_the_palette_offers_turn_on_while_off_and_turn_off_and_review_while_on() {
  const { contributes } = JSON.parse(readFileSync(`${import.meta.dirname}/../package.json`, 'utf8'))
  assert.deepEqual(contributes.configuration.properties['srmd.enabled'], { type: 'boolean', default: false, description: '%config.enabled%' })
  assert.deepEqual(contributes.commands, [
    { command: 'srmd.review', title: '%command.review%' },
    { command: 'srmd.enable', title: '%command.enable%' },
    { command: 'srmd.disable', title: '%command.disable%' },
    { command: 'srmd.toggle', title: '%command.toggle%' },
    { command: 'srmd.notes.review', title: '%command.notes.review%', icon: '$(play)' },
    { command: 'srmd.notes.edit', title: '%command.notes.edit%', icon: '$(edit)' },
    { command: 'srmd.notes.reveal', title: '%command.notes.reveal%' },
    { command: 'srmd.showNote', title: '%command.showNote%', icon: '$(go-to-file)' }
  ])
  // Row commands act on a row of the srmd view, so the palette hides them; Show Note needs the review tab.
  assert.deepEqual(contributes.menus.commandPalette, [
    { command: 'srmd.review', when: 'workspaceFolderCount > 0 && config.srmd.enabled' },
    { command: 'srmd.enable', when: 'workspaceFolderCount > 0 && !config.srmd.enabled' },
    { command: 'srmd.disable', when: 'workspaceFolderCount > 0 && config.srmd.enabled' },
    { command: 'srmd.toggle', when: 'false' },
    { command: 'srmd.notes.review', when: 'false' },
    { command: 'srmd.notes.edit', when: 'false' },
    { command: 'srmd.notes.reveal', when: 'false' },
    { command: 'srmd.showNote', when: "activeWebviewPanelId == 'srmdReviewer'" }
  ])
  const texts = JSON.parse(readFileSync(`${import.meta.dirname}/../package.nls.json`, 'utf8'))
  assert.deepEqual([texts['command.enable'], texts['command.disable']], ['srmd: Turn On', 'srmd: Turn Off'])
}

/**
 * Every manifest placeholder has an English text and every manifest translation covers exactly its keys.
 * VS Code shows a raw %key% for a missing manifest text. Runtime messages are checked in shared/l10n.
 */
export function test_every_manifest_text_has_an_english_text_and_translations() {
  const read = name => JSON.parse(readFileSync(`${import.meta.dirname}/../${name}`, 'utf8'))
  const placeholders = [...readFileSync(`${import.meta.dirname}/../package.json`, 'utf8').matchAll(/"%([^%"]+)%"/g)].map(match => match[1]).sort()
  assert.deepEqual(placeholders, Object.keys(read('package.nls.json')).sort())
  assert.deepEqual(Object.keys(read('package.nls.sv.json')).sort(), placeholders)
}

/**
 * The formatting settings offer the values of the shared formatting options, with their defaults: line breaks and
 * emphasis as written, a line width of at least 20, numbers counting up, `-` bullets and compact table delimiters.
 */
export function test_the_formatting_settings_offer_the_formatting_options() {
  const { properties } = JSON.parse(readFileSync(`${import.meta.dirname}/../package.json`, 'utf8')).contributes.configuration
  /** An enumerated setting whose values each have a text, `%config.format.<key>.<value>%`. */
  const choice = (key, values, fallback) => ({
    type: 'string', enum: values, enumDescriptions: values.map(value => `%config.format.${key}.${value}%`), default: fallback,
    description: `%config.format.${key}%`
  })
  assert.deepEqual(Object.fromEntries(Object.entries(properties).filter(([name]) => name.startsWith('srmd.format.'))), {
    'srmd.format.wrap': choice('wrap', ['preserve', 'always', 'never'], 'preserve'),
    'srmd.format.lineWidth': { type: 'integer', minimum: 20, default: 80, description: '%config.format.lineWidth%' },
    'srmd.format.numbering': choice('numbering', ['increment', 'repeat'], 'increment'),
    'srmd.format.bullet': { type: 'string', enum: ['-', '*', '+'], default: '-', description: '%config.format.bullet%' },
    'srmd.format.tableDelimiters': choice('tableDelimiters', ['compact', 'padded'], 'compact'),
    'srmd.format.emphasis': choice('emphasis', ['preserve', 'asterisk', 'underscore'], 'preserve'),
    'srmd.format.strong': choice('strong', ['preserve', 'asterisk', 'underscore'], 'preserve')
  })
}

/**
 * The manifest gives the Markdown preview the plugin activation exports and the stylesheet outlining clozes.
 * VS Code's preview activates the extension for its plugin and loads the stylesheet after its own.
 */
export function test_the_markdown_preview_gets_the_plugin_and_stylesheet() {
  const { contributes } = JSON.parse(readFileSync(`${import.meta.dirname}/../package.json`, 'utf8'))
  assert.equal(contributes['markdown.markdownItPlugins'], true)
  assert.deepEqual(contributes['markdown.previewStyles'], ['./dist/media/preview.css'])
}

// Run every test_ function above as a test named after it.
for (const [name, fn] of Object.entries(tests)) if (name.startsWith('test_')) test(name, fn)
