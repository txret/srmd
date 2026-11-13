// Exercise the updater against a real local Git remote and submodule without changing the repository's Foam pin.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { update_foam } from '../scripts/update_foam.mjs'
import * as tests from './update_foam.test.mjs'

/** Run fixture Git commands with a local identity and permission to clone the fixture's local remote. */
function git(cwd, ...args) {
  return execFileSync('git', [
    '-c', 'user.name=srmd test', '-c', 'user.email=test@example.invalid', '-c', 'protocol.file.allow=always', ...args
  ], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

/** Create an old submodule pin and a remote containing an annotated release tag followed by an unreleased commit. */
function fixture(t) {
  /* Create isolated repositories, record the parent's initial pin, then advance only the upstream repository. */
  const temp = mkdtempSync(resolve(tmpdir(), 'srmd-update-foam-'))
  t.after(() => rmSync(temp, { recursive: true, force: true }))
  const upstream = resolve(temp, 'upstream')
  const root = resolve(temp, 'srmd')
  const foam = resolve(root, 'foam')
  mkdirSync(upstream)
  mkdirSync(root)
  git(upstream, 'init', '--initial-branch=main')
  writeFileSync(resolve(upstream, 'note.md'), 'initial\n')
  git(upstream, 'add', 'note.md')
  git(upstream, 'commit', '-m', 'Initial')
  const initial = git(upstream, 'rev-parse', 'HEAD')

  // The parent keeps this first commit staged and committed throughout the tests.
  git(root, 'init', '--initial-branch=main')
  git(root, 'submodule', 'add', upstream, 'foam')
  git(root, 'commit', '-m', 'Pin Foam')
  writeFileSync(resolve(upstream, 'note.md'), 'release\n')
  git(upstream, 'commit', '-am', 'Release')
  git(upstream, 'tag', '-a', 'vscode@0.48.0', '-m', 'Release')
  const release = git(upstream, 'rev-parse', 'HEAD')
  writeFileSync(resolve(upstream, 'note.md'), 'development\n')
  git(upstream, 'commit', '-am', 'Inter-release fix')
  const development = git(upstream, 'rev-parse', 'HEAD')
  return { root, foam, initial, release, development }
}

/** The default checks out the published release, even when upstream main has advanced, without staging the new pin. */
export async function test_default_selects_the_published_release(t) {
  /* Supply release metadata while using real Git for fetching, annotated-tag resolution and detached checkout. */
  const { root, foam, initial, release } = fixture(t)
  const request = t.mock.method(globalThis, 'fetch', async () => Response.json({
    tag_name: 'vscode@0.48.0', draft: false, prerelease: false
  }))
  assert.deepEqual(await update_foam(root), { previous: initial, commit: release, target: 'vscode@0.48.0' })
  assert.equal(request.mock.calls[0].arguments[0], 'https://api.github.com/repos/foambubble/foam/releases/latest')
  assert.equal(git(foam, 'rev-parse', 'HEAD'), release)
  assert.equal(git(foam, 'rev-parse', '--abbrev-ref', 'HEAD'), 'HEAD')
  assert.equal(readFileSync(resolve(foam, 'note.md'), 'utf8'), 'release\n')
  assert.equal(git(root, 'rev-parse', ':foam'), initial)
  assert.equal(git(root, 'diff', '--cached', '--name-only'), '')
}

/** Explicit commits and release tags select exactly that revision without requiring GitHub's release API. */
export async function test_explicit_commit_and_tag_override_the_release(t) {
  /* Select an unpublished commit, then a release tag, keeping the parent's pin and the GitHub API untouched. */
  const { root, foam, initial, release, development } = fixture(t)
  const request = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected release lookup') })
  assert.deepEqual(await update_foam(root, development), { previous: initial, commit: development, target: development })
  assert.equal(readFileSync(resolve(foam, 'note.md'), 'utf8'), 'development\n')
  assert.deepEqual(await update_foam(root, 'vscode@0.48.0'), { previous: development, commit: release, target: 'vscode@0.48.0' })
  assert.equal(readFileSync(resolve(foam, 'note.md'), 'utf8'), 'release\n')
  assert.equal(request.mock.callCount(), 0)
  assert.equal(git(root, 'rev-parse', ':foam'), initial)
}

/** A patch committed only in the local submodule can be selected with no remote access, retaining its branch. */
export async function test_local_patch_needs_no_remote(t) {
  /* Create a local patch, leave its branch, and make origin unavailable so any attempted fetch would fail. */
  const { root, foam, initial } = fixture(t)
  git(foam, 'switch', '-c', 'srmd-patch')
  writeFileSync(resolve(foam, 'note.md'), 'local patch\n')
  git(foam, 'commit', '-am', 'Fix pending upstream')
  const patch = git(foam, 'rev-parse', 'HEAD')
  git(foam, 'checkout', '--detach', initial)
  git(foam, 'remote', 'set-url', 'origin', resolve(root, 'unavailable-origin'))
  const request = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected release lookup') })

  // The patch is usable for builds, while its branch and the parent's old pin remain available for review.
  assert.deepEqual(await update_foam(root, patch), { previous: initial, commit: patch, target: patch })
  assert.equal(git(foam, 'rev-parse', 'HEAD'), patch)
  assert.equal(git(foam, 'rev-parse', '--abbrev-ref', 'HEAD'), 'HEAD')
  assert.equal(readFileSync(resolve(foam, 'note.md'), 'utf8'), 'local patch\n')
  assert.equal(git(foam, 'rev-parse', 'refs/heads/srmd-patch'), patch)
  assert.equal(git(root, 'rev-parse', ':foam'), initial)
  assert.equal(request.mock.callCount(), 0)
}

/** Tracked edits and untracked files both prevent an update without losing local work. */
export async function test_local_changes_prevent_checkout(t) {
  /* Exercise tracked and untracked work separately; both must remain intact at the original commit. */
  const { root, foam, initial, development } = fixture(t)
  writeFileSync(resolve(foam, 'note.md'), 'local edit\n')
  await assert.rejects(update_foam(root, development), new Error('Foam has uncommitted changes; commit or stash them before updating'))
  assert.equal(readFileSync(resolve(foam, 'note.md'), 'utf8'), 'local edit\n')
  assert.equal(git(foam, 'rev-parse', 'HEAD'), initial)

  // Restore the tracked fixture text so only the new file prevents the second update.
  writeFileSync(resolve(foam, 'note.md'), 'initial\n')
  writeFileSync(resolve(foam, 'new.md'), 'local note\n')
  await assert.rejects(update_foam(root, development), new Error('Foam has uncommitted changes; commit or stash them before updating'))
  assert.equal(readFileSync(resolve(foam, 'new.md'), 'utf8'), 'local note\n')
  assert.equal(git(foam, 'rev-parse', 'HEAD'), initial)
}

/** Invalid overrides, release lookup failures and other release channels leave the existing pin and checkout intact. */
export async function test_invalid_targets_leave_the_checkout_intact(t) {
  /* Reject floating refs first, then simulate unavailable or unsuitable releases without contacting the network. */
  const { root, foam, initial } = fixture(t)
  await assert.rejects(update_foam(root, 'main'), new Error('Pass a stable vscode@ release tag or a full 40-character commit SHA'))
  const request = t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 503 }))
  await assert.rejects(update_foam(root), new Error('Cannot read Foam\'s latest release: HTTP 503'))
  request.mock.mockImplementation(async () => Response.json({ tag_name: 'vscode@0.49.0', draft: false, prerelease: true }))
  await assert.rejects(update_foam(root), new Error('Foam\'s latest release is not a stable VS Code release; pass a release tag or full commit SHA explicitly'))
  request.mock.mockImplementation(async () => Response.json({ tag_name: 'core@0.51.0', draft: false, prerelease: false }))
  await assert.rejects(update_foam(root), new Error('Foam\'s latest release is not a stable VS Code release; pass a release tag or full commit SHA explicitly'))
  assert.equal(git(foam, 'rev-parse', 'HEAD'), initial)
  assert.equal(git(root, 'rev-parse', ':foam'), initial)
}

// Run every test_ function above as a test named after it.
for (const [name, fn] of Object.entries(tests)) if (name.startsWith('test_')) test(name, fn)
