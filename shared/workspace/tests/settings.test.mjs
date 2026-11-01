// The shared settings (ARCHITECTURE.md, "Workspace"): stored values validated and converted for the workspace.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { read_settings } from '../src/index.ts'
import * as tests from './settings.test.mjs'

/** Valid stored values are converted: the rollover to milliseconds after midnight. */
export function test_valid_settings_are_converted() {
  const stored = {
    queueOrder: ['new', 'intraday', 'interday'], rollover: ' 05:30 ',
    suffixes: ['.cards.md', '.sr.md'], 'inactive.front': true, 'inactive.back': false
  }
  const invalid = []
  const settings = read_settings(name => stored[name], name => invalid.push(name))
  assert.deepEqual(invalid, [])
  assert.deepEqual(settings.suffixes, ['.cards.md', '.sr.md'])
  assert.deepEqual({ ...settings.scheduler }, { queue_order: ['new', 'intraday', 'interday'], rollover: 5.5 * 3600000 })
  assert.deepEqual(settings.inactive, { front: true, back: false })
}

/**
 * Values outside their schema are reported by name, in a fixed order, and replaced by their defaults: a queue order
 * missing a queue, a time past 23:59, an empty suffix, a flag that is not a boolean.
 */
export function test_invalid_settings_are_reported_and_replaced_by_defaults() {
  const stored = {
    'inactive.back': 'yes', suffixes: [''], rollover: '25:00', queueOrder: ['new']
  }
  const invalid = []
  const settings = read_settings(name => stored[name], name => invalid.push(name))
  assert.deepEqual(invalid, ['queueOrder', 'rollover', 'suffixes', 'inactive.back'])
  assert.deepEqual(settings.suffixes, ['.sr.md'])
  assert.deepEqual({ ...settings.scheduler }, { queue_order: ['intraday', 'interday', 'new'], rollover: 4 * 3600000 })
  assert.deepEqual(settings.inactive, { front: false, back: false })
}

/** Missing values take their defaults without a report: a host stores only what the user changed. */
export function test_missing_settings_take_their_defaults_silently() {
  const invalid = []
  const settings = read_settings(() => undefined, name => invalid.push(name))
  assert.deepEqual(invalid, [])
  assert.deepEqual(settings.suffixes, ['.sr.md'])
  assert.deepEqual({ ...settings.scheduler }, { queue_order: ['intraday', 'interday', 'new'], rollover: 4 * 3600000 })
  assert.deepEqual(settings.inactive, { front: false, back: false })
}

// Run every test_ function above as a test named after it.
for (const [name, fn] of Object.entries(tests)) if (name.startsWith('test_')) test(name, fn)
