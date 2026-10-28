// Search highlights in the reviewer: their redraw wiring, as far as it works without a browser.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Search } from '../src/search.ts'
import * as tests from './search.test.mjs'

/**
 * Search observes the content and each of its blocks, redraws once per frame, and releases both on dispose. Layout
 * needs a browser, where the highlight boxes were checked; this is the wiring that makes them follow reflows.
 */
export function test_search_redraws_once_per_frame_on_resize_and_releases_on_dispose(t) {
  /** Every observe/disconnect call, and the callback that the browser would call on resize. */
  const calls = []
  let notify
  /** Frames requested and not yet run or cancelled. */
  const frames = new Map()
  let next_frame = 1
  // Node has none of these browser globals, so the test supplies and removes them.
  Object.assign(globalThis, {
    ResizeObserver: class {
      constructor(callback) { notify = callback }
      observe(element) { calls.push(['observe', element.name]) }
      disconnect() { calls.push(['disconnect']) }
    },
    requestAnimationFrame: callback => {
      frames.set(next_frame, callback)
      return next_frame++
    },
    cancelAnimationFrame: handle => frames.delete(handle)
  })
  t.after(() => {
    delete globalThis.ResizeObserver
    delete globalThis.requestAnimationFrame
    delete globalThis.cancelAnimationFrame
  })
  const control = () => ({ addEventListener() {} })
  const container = { innerHTML: '', querySelector: control }
  const content = { name: 'content', children: [{ name: 'first block' }, { name: 'second block' }] }

  const search = new Search(container, content, { placeholder: 'Search...', button_lbl: 'Search' })
  assert.deepEqual(calls, [['observe', 'content'], ['observe', 'first block'], ['observe', 'second block']])
  let redraws = 0
  search.redraw = () => { redraws++ }
  notify()
  notify()
  assert.deepEqual([...frames.keys()], [1])
  frames.get(1)()
  frames.delete(1)
  assert.equal(redraws, 1)

  notify()
  search.dispose()
  assert.deepEqual(calls.at(-1), ['disconnect'])
  assert.deepEqual([...frames.keys()], [])
  assert.equal(redraws, 1)
}

// Run every test_ function above as a test named after it.
for (const [name, fn] of Object.entries(tests)) if (name.startsWith('test_')) test(name, fn)
