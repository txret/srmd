// Select a Foam commit; npm's postupdate:foam hook installs dependencies and validates srmd afterward.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Run a command in cwd, showing its progress and stopping on failure. */
function run(cwd, command, args) {
  execFileSync(command, args, { cwd, stdio: 'inherit' })
}

/** Read one Git result in cwd without mixing progress messages into the returned text. */
function git_output(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim()
}

/** Resolve a commit already present in Foam, returning null only when Git cannot resolve it to a commit. */
function local_commit(foam, revision) {
  /* Try the local object database without fetching; propagate execution failures rather than treating them as missing commits. */
  try {
    return git_output(foam, ['rev-parse', '--verify', '--quiet', `${revision}^{commit}`])
  } catch (error) {
    if (error.status === 1) return null
    throw error
  }
}

/** Read Foam's latest published stable VS Code release, whose repository also contains the core library. */
async function latest_release() {
  /* Ask GitHub for the published release, then check its channel before using its tag as a Git reference. */
  const response = await fetch('https://api.github.com/repos/foambubble/foam/releases/latest', {
    headers: { Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(30_000)
  })
  if (!response.ok) throw new Error(`Cannot read Foam's latest release: HTTP ${response.status}`)
  const release = await response.json()
  if (release.draft || release.prerelease || !/^vscode@\d+\.\d+\.\d+$/.test(release.tag_name)) {
    throw new Error('Foam\'s latest release is not a stable VS Code release; pass a release tag or full commit SHA explicitly')
  }
  return release.tag_name
}

/**
 * Check out Foam's latest release, or an explicit stable vscode@ tag or full commit SHA, inside root's submodule.
 * Explicit commits use local objects first, so a committed patch need not exist on origin; missing commits are fetched.
 * Refuse uncommitted Foam changes and leave the parent's index untouched so the new pin can be reviewed.
 * @param {string} root srmd's repository directory.
 * @param {string | undefined} revision Optional exact release tag or 40-character commit SHA.
 * @returns {Promise<{ previous: string, commit: string, target: string }>} The old and selected commits and requested ref.
 */
export async function update_foam(root, revision) {
  /* Validate the request, initialize missing sources, protect local work, and resolve and check out one exact revision. */
  if (revision !== undefined && !/^(?:vscode@\d+\.\d+\.\d+|[a-fA-F0-9]{40})$/.test(revision)) {
    throw new Error('Pass a stable vscode@ release tag or a full 40-character commit SHA')
  }
  const foam = resolve(root, 'foam')
  if (!existsSync(resolve(foam, '.git'))) run(root, 'git', ['submodule', 'update', '--init', '--', 'foam'])
  if (git_output(foam, ['status', '--porcelain', '--untracked-files=all'])) {
    throw new Error('Foam has uncommitted changes; commit or stash them before updating')
  }

  // Resolve a published tag by default; an explicit commit can select an inter-release fix or a local patch.
  const target = revision ?? await latest_release()
  /** Keep the previous SHA for the update summary, even when the existing checkout was not a release. */
  const previous = git_output(foam, ['rev-parse', 'HEAD'])
  const ref = target.startsWith('vscode@') ? `refs/tags/${target}` : target
  /** The exact checkout commit: local patches need no remote, while release tags always come from origin. */
  let commit = target.startsWith('vscode@') ? null : local_commit(foam, target)
  if (!commit) {
    run(foam, 'git', ['fetch', '--no-tags', 'origin', ref])
    commit = git_output(foam, ['rev-parse', '--verify', 'FETCH_HEAD^{commit}'])
  }

  // Detach at the selected commit: neither a local branch nor the parent's staged pin should move.
  run(foam, 'git', ['checkout', '--detach', commit])
  return { previous, commit, target }
}

// Importing update_foam for tests must not start an update of the real repository.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.length > 1) throw new Error('Usage: npm run update:foam -- [release-tag-or-full-commit-sha]')
  const { previous, commit, target } = await update_foam(resolve(import.meta.dirname, '..'), args[0])
  console.log(`Foam: ${previous} -> ${commit} (${target})`)
}
