import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { basename, dirname, resolve } from 'node:path'

import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import nodeResolve from '@rollup/plugin-node-resolve'
import esbuild from 'rollup-plugin-esbuild'
import { foam } from './scripts/rollup_foam.mjs'

const dir = dirname(fileURLToPath(import.meta.url))

/** The web build's output, which Gradle packages as the APK's assets/web/ (ignored by Git). */
const out = resolve(dir, 'native/app/src/main/assets/web')

/** The page and its stylesheets: the shared reviewer styles, then the app's layout and theme. */
const static_files = [resolve(dir, 'media/index.html'), resolve(dir, '../../shared/ui/src/reviewer.css'), resolve(dir, 'media/app.css')]

/** Emit the static files beside the script, rebuilding in watch mode when they change. */
const copy_static = () => ({
  name: 'copy-static',
  buildStart() {
    for (const file of static_files) this.addWatchFile(file)
  },
  generateBundle() {
    for (const file of static_files) this.emitFile({ type: 'asset', fileName: basename(file), source: readFileSync(file) })
  }
})

/**
 * Resolve vfile's requires of its Node-only files, `./minpath` and `./minproc`, to the browser files its package's
 * `browser` field names, which node-resolve misses for requires without an extension. vfile comes with foam-core's
 * Markdown parser.
 */
const vfile_browser = () => ({
  name: 'vfile-browser',
  resolveId(source, importer) {
    if (!importer || !/[\\/]vfile[\\/]lib[\\/][^\\/]+$/.test(importer) || !/^\.\/(?:minpath|minproc)(?:\.js)?$/.test(source)) return null
    return resolve(dirname(importer), source.replace(/(?:\.js)?$/, '.browser.js'))
  }
})

export default {
  input: resolve(dir, 'src/main.ts'),
  output: {
    // The page loads one classic script; it starts itself and exports nothing.
    file: resolve(out, 'app.js'),
    format: 'iife',
    sourcemap: true
  },
  plugins: [
    vfile_browser(),
    // Foam from the submodule, as Foam's web build bundles it, and only as far as the app uses it.
    foam(),
    // The shared components resolve as workspace packages, whose package.json points at their TypeScript source.
    nodeResolve({ browser: true, extensions: ['.mjs', '.js', '.json', '.ts'] }),
    commonjs(),
    // foam-core's dependencies import JSON data, such as HTML entity tables.
    json(),
    esbuild({
      include: /\.[jt]s$/, sourceMap: true, minify: true, target: 'chrome100',
      tsconfig: resolve(dir, '../../tsconfig.base.json')
    }),
    copy_static()
  ]
}
