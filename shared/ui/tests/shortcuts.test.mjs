// Keyboard shortcuts: how a configured shortcut, such as `Ctrl+Shift+F`, matches a key event.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { shortcut_matches } from '../src/utils.ts'
import * as tests from './shortcuts.test.mjs'

/** A KeyboardEvent-shaped press of key with the named modifiers held, and no others. */
function press(key, ...modifiers) {
  return {
    key, ctrlKey: modifiers.includes('ctrl'), shiftKey: modifiers.includes('shift'),
    altKey: modifiers.includes('alt'), metaKey: modifiers.includes('meta')
  }
}

/**
 * A shortcut matches its key with exactly its modifiers: no other key, no extra or missing modifier. Names and
 * letters ignore case, and `Space` matches the browser's space key under both of its names.
 */
export function test_a_shortcut_matches_its_key_with_exactly_its_modifiers() {
  assert.equal(shortcut_matches(press('f'), 'f'), true)
  assert.equal(shortcut_matches(press('g'), 'f'), false)
  assert.equal(shortcut_matches(press('f', 'ctrl'), 'f'), false)
  assert.equal(shortcut_matches(press('F', 'ctrl', 'shift'), 'Ctrl+Shift+F'), true)
  assert.equal(shortcut_matches(press('F', 'ctrl'), 'ctrl+shift+f'), false)
  assert.equal(shortcut_matches(press(' '), 'Space'), true)
  assert.equal(shortcut_matches(press('Spacebar', 'meta'), 'meta+Space'), true)
}

// Run every test_ function above as a test named after it.
for (const [name, fn] of Object.entries(tests)) if (name.startsWith('test_')) test(name, fn)
