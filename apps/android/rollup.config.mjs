import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { basename, dirname, resolve } from 'node:path'

import commonjs from '@rollup/plugin-commonjs'
import nodeResolve from '@rollup/plugin-node-resolve'
import esbuild from 'rollup-plugin-esbuild'

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

export default {
  input: resolve(dir, 'src/main.ts'),
  output: {
    // The page loads one classic script; it starts itself and exports nothing.
    file: resolve(out, 'app.js'),
    format: 'iife',
    sourcemap: true
  },
  plugins: [
    // The shared components resolve as workspace packages, whose package.json points at their TypeScript source.
    nodeResolve({ browser: true, extensions: ['.mjs', '.js', '.json', '.ts'] }),
    commonjs(),
    esbuild({ include: /\.[jt]s$/, sourceMap: true, minify: true, target: 'chrome100', tsconfig: resolve(dir, '../../tsconfig.base.json') }),
    copy_static()
  ]
}
