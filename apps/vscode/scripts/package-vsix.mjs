// VS Code needs an unscoped manifest name; stage it without changing the npm workspace's identity.
import * as fs from 'node:fs/promises'
import { resolve } from 'node:path'
import { createVSIX } from '@vscode/vsce'
import root_package from '../../../package.json' with { type: 'json' }

/** The extension and its temporary packaging directory; the latter is removed even if packaging fails. */
const root = resolve(import.meta.dirname, '..')
const stage = resolve(root, '.vsix-stage')
await fs.rm(stage, { recursive: true, force: true })
try {
  await fs.mkdir(stage)
  // Dependencies are bundled; build scripts and npm dependency metadata do not belong in the shipped manifest.
  const { dependencies, devDependencies, scripts, ...manifest } = JSON.parse(await fs.readFile(resolve(root, 'package.json'), 'utf8'))
  manifest.name = process.env.SRMD_VSIX_NAME ?? 'srmd'
  manifest.version = root_package.version
  manifest.private = false
  manifest.files = ['LICENSE', 'README.md', 'package.nls*.json', 'dist/**/*.js', 'dist/**/*.js.map', 'dist/media/*.css', 'resources/**', 'syntax/**']
  await fs.writeFile(resolve(stage, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')

  // Include the runtime files, translated manifest strings, marketplace page and repository license.
  const translations = (await fs.readdir(root)).filter(name => /^package\.nls(\.[\w-]+)?\.json$/.test(name))
  for (const name of ['dist', 'resources', 'syntax', 'README.md', ...translations]) {
    await fs.cp(resolve(root, name), resolve(stage, name), { recursive: true })
  }
  await fs.copyFile(resolve(root, '../../LICENSE'), resolve(stage, 'LICENSE'))

  // README links are relative to apps/vscode in the repository, not to the staging directory.
  const base = `${manifest.repository.url.replace(/\.git$/, '')}/blob/HEAD/apps/vscode/`
  await createVSIX({
    cwd: stage, packagePath: resolve(root, 'srmd.vsix'), dependencies: false,
    baseContentUrl: base, baseImagesUrl: base.replace('/blob/', '/raw/')
  })
} finally {
  await fs.rm(stage, { recursive: true, force: true })
}
