// Build foam-core in the Foam submodule with Foam's own TypeScript, into foam/packages/foam-core/out/, which Foam's
// .gitignore leaves out: TypeScript reads its declarations and Node, as in tests, its JavaScript, through the
// `@foam/core` package that links to it. srmd's TypeScript settings are stricter than Foam's, so it reads no Foam sources.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const core = resolve(dirname(fileURLToPath(import.meta.url)), '../../../foam/packages/foam-core')
const tsc = createRequire(resolve(core, 'package.json')).resolve('typescript/bin/tsc')
execFileSync(process.execPath, [tsc, '-p', resolve(core, 'tsconfig.json')], { stdio: 'inherit' })
