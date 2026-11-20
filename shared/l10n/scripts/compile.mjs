/**
 * Compile messages/<locale>.json into typed Paraglide message functions in src/paraglide/.
 *
 * Load the npm plugin offline and fail on catalog errors, which Paraglide's CLI only reports as warnings.
 */
import fs from 'node:fs'
import { resolve } from 'node:path'
import { compileProject, writeOutput } from '@inlang/paraglide-js'
import { loadProjectFromDirectory } from '@inlang/sdk'
import message_format from '@inlang/plugin-message-format'

/** The l10n component directory, holding project.inlang/, messages/ and src/. */
const root = resolve(import.meta.dirname, '..')

const project = await loadProjectFromDirectory({ path: resolve(root, 'project.inlang'), fs, providePlugins: [message_format] })
try {
  // A broken catalog must fail the calling test or build rather than compile partial messages.
  const errors = await project.errors.get()
  if (errors.length) throw new AggregateError(errors, 'Cannot compile message catalogs')
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
