// The extension's production bundle, dist/extension.js (rollup.config.mjs), which pretest builds: the packages it holds
// code of, as its sourcemap names them.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import * as tests from './bundle.test.mjs'

/** The packages a bundle holds code of, by the sources its sourcemap names, each once and sorted. */
function bundled_packages(map_url) {
  /* A source in a dependency is a path into node_modules; its package is the innermost one in the path. */
  const { sources } = JSON.parse(readFileSync(map_url, 'utf8'))
  const names = sources.map(source => source.match(/node_modules\/((?:@[^/]+\/)?[^/]+)\/(?!.*node_modules\/)/)?.[1])
  return [...new Set(names.filter(name => name !== undefined))].sort()
}

/**
 * The extension bundle holds code of srmd's own dependencies only: markdown-it, with which srmd loads notes and reviews
 * compose the installed extensions' plugins, and its own (entities, linkify-it, mdurl, punycode.js, uc.micro), and
 * ts-fsrs. Foam's syntax comes from Foam's own plugins where it is installed, so it holds neither foam-core nor any of
 * its dependencies, such as remark-parse, unified, jexl or dayjs.
 */
export function test_the_extension_bundle_holds_only_srmds_own_dependencies() {
  assert.deepEqual(bundled_packages(new URL('../dist/extension.js.map', import.meta.url)), [
    'entities', 'linkify-it', 'markdown-it', 'mdurl', 'punycode.js', 'ts-fsrs', 'uc.micro'
  ])
}

// Run every test_ function above as a test named after it.
for (const [name, fn] of Object.entries(tests)) if (name.startsWith('test_')) test(name, fn)
