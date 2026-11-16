// The root package version is authoritative; app manifests retain copies required by npm and VS Code.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Read a package manifest or lockfile as JSON. */
function read_json(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** Write JSON only when its contents change, avoiding needless rebuilds and watcher events. */
function write_json(path, value) {
  const content = JSON.stringify(value, null, 2) + '\n'
  if (readFileSync(path, 'utf8') !== content) writeFileSync(path, content)
}

/**
 * Copy root's version into both app manifests and their lockfile metadata without changing dependency resolutions.
 * @param {string} root Repository directory containing package.json and the apps/ workspaces.
 * @returns {void}
 */
export function sync_versions(root) {
  /* Read the authoritative version, update the app manifests, then align the existing lockfile's own-package entries. */
  const { version } = read_json(resolve(root, 'package.json'))
  /** The two shipped apps share the repository version; internal component packages are not released separately. */
  const apps = ['apps/vscode', 'apps/android']
  for (const app of apps) {
    const path = resolve(root, app, 'package.json')
    const manifest = read_json(path)
    manifest.version = version
    write_json(path, manifest)
  }

  // Updating version metadata must not resolve or upgrade any external dependencies.
  const lock_path = resolve(root, 'package-lock.json')
  if (!existsSync(lock_path)) return
  const lock = read_json(lock_path)
  lock.version = version
  for (const key of ['', ...apps]) {
    if (lock.packages[key]) lock.packages[key].version = version
  }
  write_json(lock_path, lock)
}

// Tests import the synchronizer with temporary repositories; only the CLI operates on this checkout.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  sync_versions(resolve(dirname(fileURLToPath(import.meta.url)), '..'))
}
