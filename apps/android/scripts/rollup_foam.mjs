/**
 * A Rollup plugin bundling Foam from the Foam submodule, `foam/`, as Foam's own web build does
 * (foam/packages/foam-vscode/esbuild.js):
 * - `@foam/core` and `@foam/core/scripting` resolve to foam-core's TypeScript source, which the app's esbuild plugin
 *   compiles like srmd's own, so Rollup leaves out what nothing uses; TypeScript and Node read foam-core's build
 *   instead (scripts/build_foam.mjs);
 * - Foam's query renderer resolves to a module adding nothing: a query needs every file's metadata, while the app
 *   parses only the files a shown one links to (src/foam.ts); lodash resolves to lodash-es, its ES modules, of which
 *   Rollup bundles only the few functions Foam uses;
 * - `fs`, from which Foam's embed plugin reads embedded notes, resolves to the app's foam_fs.ts, which serves the texts
 *   the app read beforehand, and `vm`, with which foam-core runs Foam's JavaScript queries in trusted workspaces only,
 *   to a module that refuses, as the app trusts none;
 * - the modules of foam-core's dependencies are free of side effects, as `"sideEffects": false` in their package.json
 *   would declare, so a dependency is bundled only as far as the bundled code uses it. foam-core's own modules keep
 *   Rollup's analysis: what they do as they load, such as configuring dayjs, stays.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
/** The modules standing for Node's `vm`, whose functions refuse to run anything, and Foam's query renderer, by id. */
const virtual = {
  '\0foam-vm': `
const refuse = () => { throw new Error('JavaScript queries do not run in the app') }
export const createContext = refuse
export class Script { constructor() { refuse() } }
`,
  '\0foam-no-queries': 'export default md => md'
}

/** foam-core in the submodule. */
const core = resolve(dir, '../../../foam/packages/foam-core')

/** The directory of the package called name as a module in from_dir requires it, by Node's lookup, or null. */
function find_package(name, from_dir) {
  /* Look in the node_modules folder of from_dir and of each folder above it, nearest first. */
  for (let at = from_dir; ; at = dirname(at)) {
    const candidate = join(at, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return candidate
    if (dirname(at) === at) return null
  }
}

/** The directories of the packages root depends on at run time, directly or through other packages, each once. */
function dependency_dirs(root) {
  /* Walk the dependency graph from root: read each package's dependencies and look each one up from that package. */
  /** The directories found, each walked once. */
  const found = new Set()
  /** Directories whose dependencies are still to be read. */
  const pending = [root]
  while (pending.length) {
    const at = pending.pop()
    const { dependencies = {} } = JSON.parse(readFileSync(join(at, 'package.json'), 'utf8'))
    for (const name of Object.keys(dependencies)) {
      const package_dir = find_package(name, at)
      if (!package_dir || found.has(package_dir)) continue
      found.add(package_dir)
      pending.push(package_dir)
    }
  }
  return [...found]
}

/**
 * The plugin (see the module comment). Place it before the node-resolve plugin and leave tree-shaking at its defaults,
 * which the plugin extends.
 */
export function foam() {
  if (!existsSync(join(core, 'src', 'index.ts'))) throw new Error(`No Foam submodule in ${core}: run git submodule update --init`)
  const entries = { '@foam/core': join(core, 'src', 'index.ts'), '@foam/core/scripting': join(core, 'src', 'scripting', 'index.ts') }
  const dependencies = dependency_dirs(core)
  return {
    name: 'foam',
    options(options) {
      // A configured tree-shaking option would need combining with this one; the config sets none.
      if (options.treeshake !== undefined && options.treeshake !== true) {
        throw new Error('foam() sets treeshake.moduleSideEffects: combine it with the configured treeshake option')
      }
      return { ...options, treeshake: { moduleSideEffects: id => !dependencies.some(at => id.startsWith(at + sep)) } }
    },
    resolveId(source, importer) {
      if (entries[source]) return entries[source]
      if (source === 'lodash') return this.resolve('lodash-es', importer, { skipSelf: true })
      if (source === 'fs') return resolve(dir, '../src/foam_fs.ts')
      if (source === 'vm') return '\0foam-vm'
      if (importer && /[\\/]foam-query-renderer$/.test(source)) return '\0foam-no-queries'
      return null
    },
    load(id) {
      return virtual[id] ?? null
    }
  }
}
