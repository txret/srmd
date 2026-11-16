// App manifests and lock metadata must follow the root version without changing dependency resolutions.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { sync_versions } from '../scripts/sync_versions.mjs'
import * as tests from './versions.test.mjs'

/** A root version change updates both stale app versions and lock entries while retaining all other package data. */
export function test_root_version_updates_both_apps_and_the_lockfile(t) {
  /* Build a small workspace with deliberately differing versions, synchronize it, then compare every saved object. */
  const root = mkdtempSync(resolve(tmpdir(), 'srmd-versions-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(resolve(root, 'apps/vscode'), { recursive: true })
  mkdirSync(resolve(root, 'apps/android'), { recursive: true })
  writeFileSync(resolve(root, 'package.json'), JSON.stringify({ name: 'srmd', version: '2.3.4', private: true }))
  writeFileSync(resolve(root, 'apps/vscode/package.json'), JSON.stringify({ name: '@srmd/app-vscode', version: '0.1.0', main: './dist/extension.js' }))
  writeFileSync(resolve(root, 'apps/android/package.json'), JSON.stringify({ name: '@srmd/app-android', version: '1.0.0', private: true }))
  writeFileSync(resolve(root, 'package-lock.json'), JSON.stringify({
    name: 'srmd', version: '0.1.0', lockfileVersion: 3,
    packages: {
      '': { name: 'srmd', version: '0.1.0', devDependencies: { typescript: '>=7.0.2' } },
      'apps/vscode': { name: '@srmd/app-vscode', version: '0.1.0' },
      'apps/android': { name: '@srmd/app-android', version: '1.0.0' },
      'shared/parser': { name: '@srmd/parser', version: '0.1.0' },
      'node_modules/typescript': { version: '7.0.2', resolved: 'https://example.invalid/typescript.tgz', integrity: 'fixture' }
    }
  }))

  // Run twice: already synchronized builds must retain the same metadata and dependency pins.
  sync_versions(root)
  sync_versions(root)
  assert.deepEqual(JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')), { name: 'srmd', version: '2.3.4', private: true })
  assert.deepEqual(JSON.parse(readFileSync(resolve(root, 'apps/vscode/package.json'), 'utf8')),
    { name: '@srmd/app-vscode', version: '2.3.4', main: './dist/extension.js' })
  assert.deepEqual(JSON.parse(readFileSync(resolve(root, 'apps/android/package.json'), 'utf8')),
    { name: '@srmd/app-android', version: '2.3.4', private: true })
  assert.deepEqual(JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8')), {
    name: 'srmd', version: '2.3.4', lockfileVersion: 3,
    packages: {
      '': { name: 'srmd', version: '2.3.4', devDependencies: { typescript: '>=7.0.2' } },
      'apps/vscode': { name: '@srmd/app-vscode', version: '2.3.4' },
      'apps/android': { name: '@srmd/app-android', version: '2.3.4' },
      'shared/parser': { name: '@srmd/parser', version: '0.1.0' },
      'node_modules/typescript': { version: '7.0.2', resolved: 'https://example.invalid/typescript.tgz', integrity: 'fixture' }
    }
  })
}

// Run every test_ function above as a test named after it.
for (const [name, fn] of Object.entries(tests)) if (name.startsWith('test_')) test(name, fn)
