import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const extRoot = resolve(here, '..')
const stageDir = resolve(extRoot, '.vsix-stage')

const outVsix = resolve(extRoot, 'srmd.vsix')
const stagedName = process.env.SRMD_VSIX_NAME ?? 'srmd'

/** Run a command with inherited output, rejecting unless it exits with code 0. */
const run = async (cmd, args, options) => new Promise((resolvePromise, reject) => {
  const child = spawn(cmd, args, { stdio: 'inherit', ...options })
  child.on('error', reject)
  child.on('exit', (code) => {
    if (code === 0) resolvePromise()
    else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`))
  })
})

/**
 * Stage a packaging manifest and the runtime files, then package them with vsce. The files have fixed locations in
 * the repository, so a missing one, such as dist/ before `npm run build`, fails packaging.
 */
const main = async () => {
  await fs.rm(stageDir, { recursive: true, force: true })

  try {
    await fs.mkdir(stageDir, { recursive: true })

    const originalManifestPath = resolve(extRoot, 'package.json')
    const raw = await fs.readFile(originalManifestPath, 'utf8')
    const manifest = JSON.parse(raw)

    // VS Code extension manifests require an unscoped name.
    // We stage a packaging-only manifest to avoid breaking npm workspaces.
    manifest.name = stagedName
    manifest.private = false
    manifest.files = ['LICENSE', 'README.md', 'package.nls*.json', 'dist/**/*.js', 'dist/**/*.js.map', 'dist/media/*.css', 'resources/**', 'syntax/**']

    // Avoid workspace dependency/symlink headaches during packaging.
    delete manifest.dependencies
    delete manifest.devDependencies
    delete manifest.scripts

    await fs.writeFile(resolve(stageDir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')

    // Copy only what the extension needs at runtime: bundles and styles, the icon, the syntax grammar.
    for (const dir of ['dist', 'resources', 'syntax']) {
      await fs.cp(resolve(extRoot, dir), resolve(stageDir, dir), { recursive: true })
    }
    // VS Code reads translated manifest strings from package.nls.json and package.nls.<language>.json beside package.json.
    for (const name of await fs.readdir(extRoot)) {
      if (/^package\.nls(\.[\w-]+)?\.json$/.test(name)) await fs.copyFile(resolve(extRoot, name), resolve(stageDir, name))
    }

    // The README is the extension's page in VS Code and the marketplace.
    await fs.copyFile(resolve(extRoot, 'README.md'), resolve(stageDir, 'README.md'))

    // The repository's license; vsce prompts interactively without one.
    await fs.copyFile(resolve(extRoot, '..', '..', 'LICENSE'), resolve(stageDir, 'LICENSE'))

    // Use locally installed vsce (don’t auto-download).
    // The staged README's relative links point into the repository from apps/vscode, not from the stage.
    const base = `${manifest.repository.url.replace(/\.git$/, '')}/blob/HEAD/apps/vscode/`
    await run('npx', ['--no-install', 'vsce', 'package', '--no-dependencies', '--allow-missing-repository',
      '--baseContentUrl', base, '--baseImagesUrl', base.replace('/blob/', '/raw/'), '--out', outVsix], { cwd: stageDir })
  } finally {
    await fs.rm(stageDir, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(err?.stack || String(err))
  process.exitCode = 1
})
