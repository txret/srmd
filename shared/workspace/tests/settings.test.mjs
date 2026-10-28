// The shared settings (ARCHITECTURE.md, "Workspace"): stored values validated and converted for the workspace.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parse, render } from '../../parser/src/index.ts'
import { extension_names, read_settings } from '../src/index.ts'
import * as tests from './settings.test.mjs'

/**
 * Valid stored values are converted: the rollover to milliseconds after midnight, extension names to the extensions
 * notes are parsed and rendered with, the formatting settings to the parser's formatting options. Foam's placeholders
 * render a wiki link as text.
 */
export function test_valid_settings_are_converted() {
  const stored = {
    queueOrder: ['new', 'intraday', 'interday'], rollover: ' 05:30 ', extensions: ['foam-placeholders'],
    suffixes: ['.cards.md', '.sr.md'], 'inactive.front': true, 'inactive.back': false,
    'format.wrap': 'always', 'format.lineWidth': 72, 'format.numbering': 'repeat', 'format.bullet': '+',
    'format.tableDelimiters': 'padded', 'format.emphasis': 'underscore', 'format.strong': 'asterisk'
  }
  const invalid = []
  const settings = read_settings(name => stored[name], name => invalid.push(name))
  assert.deepEqual(invalid, [])
  assert.deepEqual(settings.suffixes, ['.cards.md', '.sr.md'])
  assert.deepEqual({ ...settings.scheduler }, { queue_order: ['new', 'intraday', 'interday'], rollover: 5.5 * 3600000 })
  assert.deepEqual(settings.inactive, { front: true, back: false })
  assert.deepEqual(settings.format, {
    wrap: 'always', line_width: 72, numbering: 'repeat', bullet: '+', table_delimiters: 'padded', emphasis: 'underscore',
    strong: 'asterisk'
  })
  const parsed = parse('See [[Physiology]].', settings.extensions)
  assert.equal(render(parsed.events, { extensions: parsed.extensions }), '<p>See Link to Physiology.</p>')
  assert.deepEqual(extension_names(), ['foam-placeholders'])
}

/**
 * Values outside their schema are reported by name, in a fixed order, and replaced by their defaults: a queue order
 * missing a queue, a time past 23:59, an unknown extension, an empty suffix, a flag that is not a boolean, formatting
 * values the options lack and line widths too narrow or not whole.
 */
export function test_invalid_settings_are_reported_and_replaced_by_defaults() {
  const stored = {
    'inactive.back': 'yes', suffixes: [''], extensions: ['foam-placeholders', 'nope'], rollover: '25:00', queueOrder: ['new'],
    'format.strong': '**', 'format.lineWidth': 10, 'format.bullet': '•', 'format.wrap': true
  }
  const invalid = []
  const settings = read_settings(name => stored[name], name => invalid.push(name))
  assert.deepEqual(invalid, [
    'queueOrder', 'rollover', 'extensions', 'suffixes', 'inactive.back', 'format.wrap', 'format.lineWidth', 'format.bullet',
    'format.strong'
  ])
  assert.deepEqual(settings.suffixes, ['.sr.md'])
  assert.deepEqual({ ...settings.scheduler }, { queue_order: ['intraday', 'interday', 'new'], rollover: 4 * 3600000 })
  assert.deepEqual(settings.inactive, { front: false, back: false })
  assert.deepEqual(settings.extensions, [])
  assert.deepEqual(settings.format, {
    wrap: 'preserve', line_width: 80, numbering: 'increment', bullet: '-', table_delimiters: 'compact', emphasis: 'preserve',
    strong: 'preserve'
  })
  const fractional = []
  assert.equal(read_settings(name => ({ 'format.lineWidth': 72.5 })[name], name => fractional.push(name)).format.line_width, 80)
  assert.deepEqual(fractional, ['format.lineWidth'])
}

/** Missing values take their defaults without a report: a host stores only what the user changed. */
export function test_missing_settings_take_their_defaults_silently() {
  const invalid = []
  const settings = read_settings(() => undefined, name => invalid.push(name))
  assert.deepEqual(invalid, [])
  assert.deepEqual(settings.suffixes, ['.sr.md'])
  assert.deepEqual({ ...settings.scheduler }, { queue_order: ['intraday', 'interday', 'new'], rollover: 4 * 3600000 })
  assert.deepEqual(settings.inactive, { front: false, back: false })
  assert.deepEqual(settings.extensions, [])
  assert.deepEqual(settings.format, {
    wrap: 'preserve', line_width: 80, numbering: 'increment', bullet: '-', table_delimiters: 'compact', emphasis: 'preserve',
    strong: 'preserve'
  })
}

// Run every test_ function above as a test named after it.
for (const [name, fn] of Object.entries(tests)) if (name.startsWith('test_')) test(name, fn)
