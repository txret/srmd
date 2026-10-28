// The web app's end of the shell's channel (ARCHITECTURE.md, "Bridge messages"): requests, replies and events.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Bridge, BridgeError } from '../src/bridge.ts'
import * as tests from './bridge.test.mjs'

/** A channel as the shell injects it: what the page posted, and a way to deliver the shell's messages. */
function fake_channel() {
  const channel = {
    sent: [],
    onmessage: null,
    postMessage(message) { channel.sent.push(JSON.parse(message)) },
    deliver(message) { channel.onmessage({ data: JSON.stringify(message) }) }
  }
  return channel
}

/**
 * Each request carries a new id and settles with the reply of the same id, in whatever order replies come; an error
 * reply rejects with the shell's code. Replies to unknown ids and unreadable messages are dropped.
 */
export async function test_replies_settle_their_requests_by_id() {
  const channel = fake_channel()
  const bridge = new Bridge(channel)
  const read = bridge.request('files.read', { path: 'a.sr.md' })
  const write = bridge.request('files.write', { path: 'a.sr.md', text: 'x', expected_mtime: 5 })
  assert.deepEqual(channel.sent, [
    { id: 1, method: 'files.read', params: { path: 'a.sr.md' } },
    { id: 2, method: 'files.write', params: { path: 'a.sr.md', text: 'x', expected_mtime: 5 } }
  ])
  channel.deliver({ id: 2, error: { code: 'conflict', message: 'a.sr.md changed' } })
  channel.deliver({ id: 9, result: {} })
  channel.onmessage({ data: 'not json' })
  channel.deliver({ id: 1, result: { text: 'Q:: a', mtime: 5, size: 5 } })
  assert.deepEqual(await read, { text: 'Q:: a', mtime: 5, size: 5 })
  const error = await write.catch(error => error)
  assert.ok(error instanceof BridgeError)
  assert.deepEqual([error.code, error.message], ['conflict', 'a.sr.md changed'])
}

/** Events reach every listener of their name, with their params, or an empty object without. */
export function test_events_reach_their_listeners() {
  const channel = fake_channel()
  const bridge = new Bridge(channel)
  const received = []
  bridge.on('resume', params => received.push(['resume', params]))
  bridge.on('back', params => received.push(['back 1', params]))
  bridge.on('back', params => received.push(['back 2', params]))
  channel.deliver({ event: 'back' })
  channel.deliver({ event: 'resume', params: { away: 1200 } })
  channel.deliver({ event: 'pause' })
  assert.deepEqual(received, [['back 1', {}], ['back 2', {}], ['resume', { away: 1200 }]])
}

// Run every test_ function above as a test named after it.
for (const [name, fn] of Object.entries(tests)) if (name.startsWith('test_')) test(name, fn)
