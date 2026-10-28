# Running tests

Install dependencies once with `npm install` at the repository root. Use Node
20.19 or later. Then run `npm test` in the directory you are working on:

| Directory            | What runs                                                                      |
|----------------------|--------------------------------------------------------------------------------|
| Repository root      | The optional extensions, all shared components, then VS Code and Android       |
| `extensions/<name>/` | One optional micromark extension, with plain micromark                         |
| `shared/`            | Parser, scheduler, reviewer, UI, workspace and messages                        |
| `shared/scheduler/`  | Manual hints, FSRS, review days, queues and folder counts                      |
| `shared/reviewer/`   | Review preparation and load/review/save round trips                            |
| `shared/parser/`     | Clozes, references, definitions, saving, transcription and the parser API      |
| `shared/ui/`         | Shared UI tests                                                                |
| `shared/l10n/`       | Catalog parity, language matching and message output (compiles messages first) |
| `shared/workspace/`  | Loading, reviewing and saving over in-memory files; settings; the file tree    |
| `apps/vscode/`       | The extension in a mocked VS Code: review, scopes, views, workspace, preview   |
| `apps/android/`      | The web app's parts in Node, and the built app in headless Chromium            |

The parent commands delegate through npm workspaces. Each component uses Node's
built-in test discovery and assertions; there is no custom test runner. Shared
tests use [tsx](https://tsx.is/node-enhancement) to import TypeScript source
directly. The only common setup is [setup.mjs](setup.mjs), which fixes the timezone
to `Europe/Stockholm` for scheduling and daylight-saving fixtures.

Tests live in `*.test.mjs` files under the component's `tests/` directory, one
file per topic. Import the code being tested directly.

Write each test as an exported function named `test_` and the behavior it checks,
with a JSDoc stating that behavior. A test is complete in itself, so it can be
checked on its own: its inputs, calls and every assertion are in its body. Related
cases of one behavior, such as emphasis and strong emphasis, are consecutive
assertions in one test rather than rows of a table looped over; behaviors already
tested elsewhere are not tested again. Helpers only build inputs or run the code
under test and return what to compare; they never assert, so every comparison is
visible where it is made. Each file imports itself and ends by registering its
tests, which Node then runs in alphabetical order:

```js
import * as tests from './clozes.test.mjs'

/** An implicit inline cloze runs to the end of its paragraph. */
export function test_implicit_inline_cloze_runs_to_its_paragraph_end() {
  assert.equal(render(parse('Q:: answer\nnext').events), `
<p>Q: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">answer
next</span></p>`.slice(1))
}

// Run every test_ function above as a test named after it.
for (const [name, fn] of Object.entries(tests)) if (name.startsWith('test_')) test(name, fn)
```

A test that needs Node's test context, for mocked timers or methods, takes it as
its parameter, `t`.

Compare complete results with `assert.equal` or `assert.deepEqual`: full HTML
(including scheduling attributes), saved Markdown, card records and review choices.
Keep expected values literal; do not strip attributes, match only a substring, or
calculate an expected result using the implementation under test. Structural checks
such as balanced token identities supplement the complete output comparisons.

Write text examples as left-aligned template literals with the opening backtick
on its own line. `.slice(1)` removes only that formatting newline, leaving all
actual leading/trailing whitespace and source offsets intact:

```js
const source = `
Q:: answer`.slice(1)
const expected = `
<p>Q: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">answer</span></p>`.slice(1)
assert.equal(render(parse(source).events), expected)
```

Keep significant invisible characters explicit: `\x20` for trailing spaces,
`\t` for tabs and `\r` before a displayed newline for CRLF. Do not trim fixtures.
Complete card definitions can be compared as one multiline string, retaining every
card and field in order.

Put disk-loaded input or expected-output fixtures **beside the test file**. The
VS Code tests use complete `.html` files in `apps/vscode/tests/` for the review
tab's static document and for the card markup each card message carries, so both
can be compared byte for byte.
The extension bundles in `dist/` are generated application code, not fixtures.

From a component directory, filter by name or run one file:

```sh
npm test -- --test-name-pattern='definition'
node --import tsx --import ../../tests/setup.mjs --test tests/definitions.test.mjs
```

The second example runs from `shared/parser/`. For a failing assertion,
Node reports the case, source location and actual/expected values. A failed
component makes the parent `npm test` fail too.

Root shortcuts are also available: `npm run test:shared`, `test:parser`,
`test:scheduler`, `test:reviewer`, `test:ui`, `test:workspace`, `test:vscode` and
`test:android`. For example:

```sh
npm run test:parser -- --test-name-pattern='definition'
```

The VS Code tests run the extension in a mocked `vscode` module,
[host.mjs](../apps/vscode/tests/host.mjs): `start_host()` activates the extension
with a workspace of in-memory notes and returns the host, whose methods act as the
user or VS Code would. The `pretest` command runs the extension's production build
(`npm run build`: messages, typecheck and Rollup) into `apps/vscode/dist/`, so the
tests exercise the bundles that ship. Those outputs are ignored by Git. Each
webview document executes the app's reviewer bundle with small DOM and VS Code
adapters, and the mock delivers the host's card messages to it asynchronously. Button and keyboard input therefore pass
through the shared controls and the VS Code message bridge before reaching the
host's save loop. Browser layout is not simulated. The host tests require neither
an installed extension nor a running VS Code instance.

The Android tests in [apps/android/tests/](../apps/android/tests/) test the web
app's modules that need no browser in Node, against fakes of the shell and the
cache. [app.test.mjs](../apps/android/tests/app.test.mjs) runs the built web app,
which `pretest` builds, in headless Chromium through the DevTools protocol, with
[mock_native.js](../apps/android/tests/mock_native.js) standing in for the Kotlin
shell: it answers the bridge's requests from files held in memory and records what
the app wrote, opened and told the shell. The tests swipe and tap as on a phone,
press Back, and restart the page; the clock is fixed and nothing animates. Without
a Chromium they are skipped: [browser.mjs](../apps/android/tests/browser.mjs) finds
one through `CHROME`, Playwright's download or the `PATH`. The shell's Kotlin unit
tests run with Gradle, `npm run test:native` in `apps/android/`, which needs a JDK.

The parser inspector is [inspection.mjs](../shared/parser/tests/inspection.mjs):

```sh
# From the repository root:
npm run parse -- --serialize shared/parser/tests/examples/reordered.sr.md

# From shared/parser:
npm run inspect -- --serialize tests/examples/reordered.sr.md
```

The inspector reads source without modifying files. `--source` prints serialized
Markdown, `--html` prints rendered HTML, and `--json` reports parser details.

The parser inspector preserves manual hints as written. Hint resolution is tested
in the scheduler component, where review time and tie breaking can be supplied explicitly.
