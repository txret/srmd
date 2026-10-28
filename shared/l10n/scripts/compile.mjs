/**
 * Compile messages/<locale>.json into typed Paraglide message functions in src/paraglide/.
 *
 * Paraglide's own CLI downloads the message-format plugin from a CDN listed in project.inlang/settings.json.
 * This script provides the plugin installed from npm instead, so compiling works offline with the locked version.
 * Run it before anything imports `src/paraglide/`: the l10n, reviewer, ui and VS Code scripts do so as pre-steps.
 */
import fs from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileProject, writeOutput } from '@inlang/paraglide-js'
import { loadProjectFromDirectory } from '@inlang/sdk'
import message_format from '@inlang/plugin-message-format'

/** The l10n component directory, holding project.inlang/, messages/ and src/. */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const project = await loadProjectFromDirectory({ path: resolve(root, 'project.inlang'), fs, providePlugins: [message_format] })
try {
  // A broken catalog must fail the calling test or build rather than compile partial messages.
  const errors = await project.errors.get()
  if (errors.length) {
    for (const error of errors) console.error(error)
    process.exit(1)
  }
  const output = await compileProject({
    project,
    compilerOptions: {
      // Hosts select one language at start-up with set_language(); there is no cookie, URL or request scope.
      strategy: ['globalVariable', 'baseLocale'],
      isServer: 'false',
      // TypeScript reads the generated declarations; the output directory ignores itself in git.
      emitTsDeclarations: true,
      emitReadme: false,
      emitPrettierIgnore: false
    }
  })
  await writeOutput({ directory: resolve(root, 'src/paraglide'), output, cleanDirectory: true, fs: fs.promises })
} finally {
  await project.close()
}
