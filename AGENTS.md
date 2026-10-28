## Architecture

The repo architecture is specified in ARCHITECTURE.md - read it before editing.

## Components and boundaries

The portable code belongs in `shared/`. Platform hosts should remain small adapters for file access, configuration, resource URLs, and the review surface. Bundle runtime dependencies with Rollup so reviewing does not require external services.

- `shared/parser/src/`: parse/render/serialize/format, transcription for other Markdown renderers, Markdown syntax, reference matching and definition storage. Preserve stored scheduling and hints without evaluating them.
- `shared/scheduler/src/`: manual hints, due-day balancing, FSRS, note/folder state, queues and counts. FSRS conversion stays internal; cards use the parser's portable record fields.
- `shared/reviewer/src/`: host-independent review snapshots, plain-text choices and rating mappings.
- `shared/ui/src/`: HTML controls, DOM interaction, display settings and search for web-based reviewers.
- `shared/l10n/`: Paraglide message catalogs for every component and host (`messages/<locale>.json`) and the language selection. Components call the compiled, typed `m.<key>()` functions instead of hard-coding user-facing text; `scripts/compile.mjs` generates them into the git-ignored `src/paraglide/`. The VS Code manifest keeps its texts in `apps/vscode/package.nls*.json`.
- `shared/workspace/src/`: loading, reviewing and saving a folder's notes over a host's `Storage`, with the serial task queue; the settings hosts share and their validation; the tree of all files for hosts listing more than notes.
- `apps/vscode/`: VS Code filesystem integration, file search and watching around the shared workspace, note tree, review tab (webview host), Markdown preview plugin, note formatter, extension manifest, and syntax-highlighting grammar.
- `apps/android/`: the Android app. `src/` is its web app, TypeScript on the shared components (views, drawer, review, CodeMirror editor, settings); `native/` its Kotlin shell (one WebView, the Storage Access Framework, the message bridge). See `apps/android/ARCHITECTURE.md`.

The applications are the VS Code extension and the Android app, which provides reading, review and editing modes. A browser application is deferred; it could reuse the Android web app with a different `Storage`. An iOS host is also future work. Notes sync using the user's existing approach, such as Git or Syncthing, rather than an srmd service.

## Development

- Prefer classic JS/TS types and syntax like `[]` arrays and `{}` dicts, avoid things like `Array<T>`/`Map<T>` unless there is an actual point (like guaranteed insertion order).
- Prefer snake_case, with PascalCase for types.
- JavaScript/TypeScript has no end-of-line semicolons.
- Prefer explicit types and small pure functions.
- Keep most logic in shared TypeScript so hosts primarily provide filesystem access and a review surface.
- Keep tests in the owning component's `tests/` directory (`shared/{l10n,parser,scheduler,reviewer,ui,workspace}/tests/` or `apps/<host>/tests/`; Kotlin unit tests in `apps/android/native/app/src/test/`). Run `npm test` in a component for its tests, in `shared/` for all portable tests, or at the repository root for all tests. Use Node's test runner with direct source imports through `tsx`; keep fixtures and expectations explicit. Write each test as an exported `test_*` function, complete in itself with every assertion in its body and its behavior in its JSDoc; group related cases as consecutive assertions instead of looped tables, don't duplicate tests, keep helpers free of assertions, and register a file's tests with the loop at its end (see `tests/README.md`). Compare complete outputs without substring matches or stripped attributes. Use left-aligned template literals for text examples, preserving meaningful whitespace, and put disk-loaded fixtures beside their test file.
- Prefer iterative, mechanically simple implementations and avoid unnecessary dependencies.
- Declare external dependencies with open-ended ranges (`>=` the version last tested); `package-lock.json` pins what is installed, so update deliberately and rerun all tests. Exception: `@types/vscode` matches the minimum `engines.vscode`, so the typecheck rejects VS Code APIs that version lacks.
- Document a caller interface using JSDoc/TSDoc for all functions.
- For all multiline functions of more than two statements add a comment block at the start of the function that outlines the different steps/parts of the function. Shorter functions need only their JSDoc/TSDoc. Also document terminology used, e.g. what is meant by `span` in this context? An html entity? A substring of a text? A slice of an array of events? Target the comment at a developer debugging, optimizing or extending the function.
- At the main steps/sections of a function insert comment outlining purpose and general concept of that step/section.
- Add comments for global variables and variables in use across different sections of its scope describing what they represent and their purpose/need, not just "array of positions of all capital letters" but why those positions are needed etc.
- `<DOC xyz>` is used inside comments to request further documentation, e.g. `/** Open block container positions - whether we are still at the block start. <DOC what is the array used for/why neccessary> */` indicating need for further documentation describing the purpose/need for tracking block container positions.
