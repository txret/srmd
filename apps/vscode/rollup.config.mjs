import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { basename, dirname, resolve } from 'node:path'

import commonjs from '@rollup/plugin-commonjs'
import nodeResolve from '@rollup/plugin-node-resolve'
import esbuild from 'rollup-plugin-esbuild'

const dir = dirname(fileURLToPath(import.meta.url))

// The shared components resolve as workspace packages, whose package.json points at their TypeScript source.
const resolve_plugin = nodeResolve({
  preferBuiltins: true,
  extensions: ['.mjs', '.js', '.json', '.node', '.ts']
})

/**
 * Stylesheets of the review webview, the shared reviewer styles then the VS Code theme layer, and of the Markdown
 * preview, which the manifest's `markdown.previewStyles` adds to VS Code's own.
 */
const stylesheets = [
  resolve(dir, '../../shared/ui/src/reviewer.css'), resolve(dir, 'media/reviewer-vscode.css'), resolve(dir, 'media/preview.css')
]

/** Emit the stylesheets into dist/media/ beside the extension bundle, rebuilding in watch mode when they change. */
const copy_stylesheets = () => ({
  name: 'copy-stylesheets',
  buildStart() {
    for (const file of stylesheets) this.addWatchFile(file)
  },
  generateBundle() {
    for (const file of stylesheets) this.emitFile({ type: 'asset', fileName: `media/${basename(file)}`, source: readFileSync(file) })
  }
})

const app_plugins = () => [
  resolve_plugin,
  commonjs(),
  esbuild({
    include: /\.[jt]s$/,
    sourceMap: true,
    target: 'es2020',
    tsconfig: resolve(dir, '../../tsconfig.base.json')
  })
]

export default [
  {
    input: resolve(dir, 'src/extension.ts'),
    output: {
      file: resolve(dir, 'dist/extension.js'),
      format: 'cjs',
      sourcemap: true,
      exports: 'named'
    },
    external: ['vscode'],
    plugins: [...app_plugins(), copy_stylesheets()]
  },
  {
    input: resolve(dir, 'src/reviewer.ts'),
    output: {
      // The webview script starts itself from the document and exports nothing.
      file: resolve(dir, 'dist/reviewer.js'),
      format: 'iife',
      sourcemap: true
    },
    plugins: app_plugins()
  }
]
