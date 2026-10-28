# srmd architecture

[SYNTAX.md](SYNTAX.md) defines syntax, note HTML, and serialization. This document covers components and integration. Simple note editing takes priority over retaining scheduling after substantial edits.

## Code base

`shared/` contains platform-independent behavior; `apps/` handles host UI and filesystem integration.

| Location            | Responsibility                                                                                                                          |
|---------------------|-----------------------------------------------------------------------------------------------------------------------------------------|
| `shared/parser/`    | Syntax, reference matching, note rendering, serialization. Built-in GFM; optional micromark extensions. No scheduler or UI dependency.  |
| `shared/scheduler/` | FSRS, hints, due-day balancing, queues, note/folder tree and counts.                                                                    |
| `shared/reviewer/`  | Rendered note, interval previews, choices, rating mappings, notices. No files, DOM, or host callbacks.                                  |
| `shared/ui/`        | HTML controls, DOM interaction, shortcuts, search, `UIConfig`. Optional for hosts using their own controls.                             |
| `shared/l10n/`      | Shared and host translations.                                                                                                           |
| `shared/workspace/` | Loading, reviewing and saving a folder's notes over a host's file access; the settings hosts share; a tree of all files.                |
| `apps/vscode/`      | VS Code settings, file search and watching, review tab, tree, decorations, and Markdown preview.                                        |
| `apps/android/`     | Android app: a Kotlin shell around one WebView running the web app; see [apps/android/ARCHITECTURE.md](apps/android/ARCHITECTURE.md).   |
| `extensions/`       | Optional `{ syntax, html }` micromark pairs; currently [micromark-foam-placeholders](extensions/micromark-foam-placeholders/README.md). |
| `shared/index.ts`   | Host-facing exports.                                                                                                                    |

## Parser

### API and data flow

| API                                        | Contract                                                                                                                                                                                                                                                                     |
|--------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `parse(source, extensions?)`               | One micromark document with GFM, optional extensions, and srmd. Returns untouched source, live events, scheduling in card order, source records/positions, hint definitions, and definition problems. Stores extensions in `ParsedNote.extensions`; leaves hints unresolved. |
| `render(events, options?)`                 | Compiles events using GFM, srmd, and `options.extensions` from parsing. Scheduling is shared with cloze tokens; `scheduling` accepts replacement records.                                                                                                                    |
| `serialize(parsed, scheduling)`            | Returns normalized Markdown from retained records and block boundaries. No reparse, parse/reference mutation, or I/O.                                                                                                                                                        |
| `persist_hints(source, hints, scheduling)` | Replaces hint state/due fields only; inserts due if absent.                                                                                                                                                                                                                  |
| `transcribe(parsed, marks)`                | Rewrites the source line for line for other Markdown renderers: markers become the opener's colon or `marks.filler`, references `marks.filler`, definitions and reference lines `___`. Inline clozes stand between `marks.open`/`marks.close`; block clozes are line ranges. |
| `format(source, extensions?)`              | Lays out the blocks anew and keeps inline content as written (see "Formatting"). Returns the source itself when formatted already, and null when the result would render differently.                                                                                        |

`resolve_clozes()` walks events once, builds clozes/groups, retains first-cloze tokens, shares scheduling with continuations, and records references/definitions. `locate()` assigns position keys and insertions; `match_cards()` resolves ownership and definitions. No source rescans or group reconstruction.

`ParsedNote.hints` retains matched hint definitions. `ParsedNote.problems` records orphaned/duplicate definitions with reference and source line for host warnings. Parsing has no clock, randomness, workspace state, FSRS, normalization, or I/O.

Callers supply matching source/events with parser contexts and one valid scheduling record per card, in ordinal order. Hosts validate external settings/scheduling; internal APIs assume valid records. Syntax extensions validate grammar. Empty Markdown is valid.

### Source layout

All paths below are under `shared/parser/src/`.

| File                      | Responsibility                                                                                                                                                                                                                           |
|---------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `index.ts`                | Public parse/render pipeline.                                                                                                                                                                                                            |
| `micromark_srmd_cloze.ts` | Marker tokenizers, cloze resolver, cloze HTML handlers.                                                                                                                                                                                  |
| `micromark_srmd_card.ts`  | Reference, reference-line, and definition tokenizers and HTML handlers.                                                                                                                                                                  |
| `positions.ts`            | Reference/first-cloze position keys and insertions: `t<offset>` for text endings, skipping trailing whitespace, line endings, and references; `l<offset>` for reference lines associated with a block's start offset in the same parent. |
| `cards.ts`                | Reference matching and card record creation/formatting.                                                                                                                                                                                  |
| `serialize.ts`            | Private save-time source editing helpers.                                                                                                                                                                                                |
| `transcribe.ts`           | Transcription without srmd syntax for other Markdown renderers, such as VS Code's preview.                                                                                                                                               |
| `format.ts`               | Formatting through mdast: the tree's srmd nodes, copies of texts from the source, srmd's handlers and blank lines.                                                                                                                       |
| `types.ts`                | Shared parser records.                                                                                                                                                                                                                   |

Tokenizers use micromark character predicates and whitespace factory. Hosts call parser APIs directly, without note adapters. `shared/parser/tests/inspection.mjs` uses parser APIs only; no hint evaluation.

### Formatting

`format()` builds an mdast tree with `mdast-util-from-markdown`, using the micromark extensions `parse()` uses plus YAML front matter, which Foam notes start with, and writes it with `mdast-util-to-markdown`. mdast has no API compiling an existing event stream, so the source is tokenized once more. Blocks are one blank line apart, with a final line ending and the source's line endings; headings are ATX unless their text spans lines; a bullet's content follows a space, an ordered item's starts at the next tab stop (`1.  item`), as in the notes; code is fenced, breaks are `---`, and tables aligned.

The inline content of paragraphs, headings and table cells, and link definitions, is copied from the source rather than serialized from the tree, which would escape brackets and underscores and respell links: escapes, emphasis, links, srmd markers and references, and Foam's wiki links and block anchors stay as written. A copy leaves out container prefixes, indentation of fewer than four columns and trailing whitespace; a hard break of trailing spaces becomes a backslash.

`FormatOptions` choose what Markdown writes in more than one way; `default_format_options` write notes as they mostly are, and `format_choices` lists the values: `wrap` keeps a paragraph's line breaks (`preserve`), wraps at `line_width` (`always`) or joins its lines (`never`); `numbering` counts ordered items up or repeats the first number; `bullet` is `-`, `*` or `+`; `table_delimiters` writes delimiter rows `|---|:-:|` (`compact`, as the notes and these documents do) or `| --- | :-: |` (`padded`); `emphasis` and `strong` keep their delimiters (`preserve`) or take asterisks or underscores.

Wrapping and respelling rewrite a copy, tokenized alone. Lines break and join only at whitespace in the text itself, its emphasis and link text, and at the line breaks of code spans; a wiki link is one word. No line breaks before a word that would start a block there, such as a bullet, a number, `#`, `>` or a reference line, or after a backslash that would escape the line break; a line break after a hard break or an implicit cloze opener, which renders differently from a space, stays. Widths count container prefixes and list markers, from to-markdown's position tracking. Emphasis takes the other delimiter only where that is not next to the same character and, for `_`, not within a word; outer constructs are respelled first, so inner ones see their new neighbors. A rewrite is written only if the copy and the rewrite render alike; otherwise the next candidate, with only the lines or only the emphasis changed, or else the copy.

srmd's flow constructs are nodes of their own. A reference line keeps its references without spaces between them and follows its block directly, after one blank line in a loose list item or below HTML; one more than a blank line away belongs to no card and stays two blank lines away. A card definition keeps single spaces between its fields; consecutive definitions, link definitions among them, stand on consecutive lines.

The result is compared with the source by rendering both with `render(parse())`, ignoring only whitespace that does not show; one rendering differently, a defect of the formatter, is not returned.

## Scheduler

### State and API

Shared state retains parser timestamp/state spellings; FSRS conversion stays in the scheduler. `Card.ordinal` indexes cards/queues; `Card.ref` retains the card reference.

`State` holds notes, folders, counts, and settings; no scheduler-instance or host dependencies. Its prototype-free node dictionary accepts paths such as `constructor` and `__proto__`. Hosts may extend it or retain separate state. `Note`/`Folder` have typed card arrays/child paths. Notes store `problems` and `version` (parsed source); folders count descendant notes with problems.

| API                                              | Contract                                                                                                                                                                                |
|--------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `Scheduler.create_note(path, parsed.scheduling)` | Copies records, adds ordinals, resolves hints, records invalid dates, and returns `{ note, scheduling_changed }`. Leaves the parse unchanged.                                           |
| `load(root)`                                     | Resets the tree to an empty root.                                                                                                                                                       |
| `update()`                                       | Inserts/replaces notes while keeping each path exclusively a note or folder. Replacing a folder with a note removes its descendants; creating a needed folder replaces a blocking note. |
| `rated(path, ordinal, rating, date)`             | Computes a rated copy without mutating state.                                                                                                                                           |
| `apply(path, card, date)`                        | Commits a card after persistence succeeds.                                                                                                                                              |
| `review()`                                       | Rates and commits together.                                                                                                                                                             |
| `peek()`                                         | Returns numeric interval previews (`Interval`: `{ unit, count }`), without translated labels.                                                                                           |
| `get_counts(node)`                               | Aggregates due, new, and later cards for a note or folder.                                                                                                                              |

Syntax options belong to the parser, display defaults to UI, and filename suffixes to hosts.

### Queues and review days

| Queue    | Membership and availability                                                                                                             |
|----------|-----------------------------------------------------------------------------------------------------------------------------------------|
| New      | Never reviewed.                                                                                                                         |
| Interday | Due this review day or overdue, and not reviewed during it. Available from the day's start, regardless of a later stored time that day. |
| Intraday | Reviewed this review day and due again during it. Available at the exact due time.                                                      |

Queue order defaults to intraday, interday, new; each must occur once. Selection follows this order. Reviewed cards leave today's queues or return to intraday if due again today.

Review days start at configurable local rollover, default 04:00, following calendar days through DST. Recounts rebuild queues only on day changes; otherwise, update availability.

New/interday cards follow ascending ordinal per note. Notes follow depth-first display order: folders first, case-insensitive names with numeric comparison, exact-text tiebreaker. Child lookup uses exact paths. Intraday work interrupts according to queue priority.

Counts are **due** (interday plus currently available intraday), **new**, and **later** (all remaining cards, including intraday cards due later, future days, and invalid dates).

### Hints and fixed-interval choices

See [manual scheduling](SYNTAX.md#manual-scheduling). Hints modify the scheduler's copy. Only `!` scans other loaded notes, excluding the replaced note; earlier hints in that note affect later choices. Startup balancing uses notes loaded so far.

Hints record no review or FSRS memory; a card scheduled only by hints starts its first review as newly learned.

The reviewer's fixed-interval choices, `tomorrow` (1 day ahead), `soon` (3–5 days) and `later` (7–21 days), are reviews, not manual scheduling: they record review time, interval, and review count, and seed missing FSRS memory; `soon` and `later` take the least-loaded day among loaded notes, breaking ties randomly.

## Reviewer and UI

`note_from_parse(scheduler, path, parsed)` combines `create_note()`, parser problems, and source `version`; hosts insert its result.

`review_scopes(state, query, root_name)` lists the notes and folders holding cards, with counts and problem flags, for choosing what to review: in display order without a query, otherwise those whose path contains every whitespace-separated term as in-order characters (the open folder matches by name), ranked by runs and word starts, then shorter paths.

`prepare_review()` combines parse/current scheduling, renders with retained extensions, and supplies `ReviewData`: translated choices/details, interval previews, rating mappings, and `problem_text()` notices. Note output follows [SYNTAX.md](SYNTAX.md#html).

`compile_html()` inserts rendered note HTML and escapes titles, labels, choices, and notices. The title is the note's workspace-relative path; notices sit between title and note. `mount(root, ordinal, config)` marks the reviewed card's clozes `active` and hides the clozes the front does not show; hosts call it in the task that inserts the markup, so the browser cannot paint a cloze before it is hidden. `UIConfig` supplies translated labels.

Styles use `--sr-*` for fonts, colors, and corner radius; `UIConfig.night_mode` enables the dark palette. Button descendants share click handling. Space/Enter activates the focused button before default shortcuts.

Initial scrolling uses the first active cloze, in this priority order:

1. Last preceding thematic break.
2. If nested the first cloze of its outermost parent group.
3. End of the preceding group's last cloze, if root-level with a preceding group.
4. Note start.

Search highlights overlay text without changing note DOM. `ResizeObserver` watches content/top-level blocks and schedules next-frame redraws on layout changes, including image loads and hidden clozes changing size. Disconnect on unmount.

## Workspace

`shared/workspace/` holds what every host does with a folder's notes, so all hosts load and save them alike: a difference would let one app damage what another wrote. Hosts supply file access, a `Storage` of `read()`, `write()` and optionally `load()`, a copy of a note's text the host checked against the file, used only for loading. They find the notes by listing, watching or scanning their folder, present the state, and extend `Workspace` or call it.

| API                                               | Contract                                                                                                                                                     |
|---------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `run(task)`                                       | Serializes tasks: loads, change batches, review selection, rating saves, edits and recounts, including their file I/O.                                       |
| `add(paths)`                                      | Loads, parses and inserts notes, eight reads in flight; persists resolved hints; returns how many have problems. Unreadable notes are logged.                |
| `apply(remove, load)`                             | Removes notes and reads others anew, then publishes counts, persists hints and announces new problems. An unreadable note keeps its state.                   |
| `reload(path, parsed)`, `is_current()`            | Replaces a note from a newer parse; whether a parse's text is `Note.version`.                                                                                |
| `next_card(scope)`                                | Selects a card and rereads its note; a changed note is reloaded and selection repeats (see "Review and persistence").                                        |
| `rate(card, rating)`                              | Rereads the note: changed, the rating is dropped and the note reloaded; else saved with `serialize()`, then committed. Failures leave it due.                |
| `save_text(path, text, base)`                     | Saves an edit unless the file no longer holds base, the text editing began from; a null base overwrites. A saved note is reloaded.                           |
| `read_settings(get, invalid)`                     | Validates the settings hosts share, under VS Code's names: suffixes, queue order, rollover, inactive clozes, extensions, formatting. Invalid values default. |
| `file_kind()`, `folder_children()`, `tree_rows()` | A tree of every file of a listing, notes and folders with the scheduler's counts, in display order (`compare_siblings()`).                                   |

`WorkspaceEvents.refreshed()` publishes counts after each recount and `problems(count)` announces notes newly having problems. Log messages are `workspace_*` texts.

## VS Code host

### Files and configuration

| File              | Responsibility                                                                 |
|-------------------|--------------------------------------------------------------------------------|
| `extension.ts`    | Compose modules and register commands.                                         |
| `settings.ts`     | Read settings, validated with `read_settings()`; write workspace enablement.   |
| `status.ts`       | Status bar item.                                                               |
| `workspace.ts`    | The shared `Workspace` with file search, watching, load progress and recounts. |
| `filesystem.ts`   | Adapt VS Code filesystem APIs.                                                 |
| `review_panel.ts` | Single review tab and review loop over `next_card()` and `rate()`.             |
| `reviewer.ts`     | Webview script: show each card and forward its first rating.                   |
| `preview.ts`      | Markdown preview plugin rendering notes with the shared parser.                |
| `formatter.ts`    | Format Document for notes with the shared `format()`.                          |
| `pick.ts`         | Quick pick choosing what to review, searching `review_scopes()`.               |
| `tree.ts`         | srmd tree view.                                                                |
| `explorer.ts`     | Resource decorations, counts, and tooltips.                                    |

`srmd.enabled` defaults to `false`. Disabled activation shows only the status item: no search, watching, recount, rows, or decorations. `config.srmd.enabled` controls the Flashcards view and palette Review/Turn Off commands. Turn On, Turn Off, and `srmd.toggle` write the workspace setting; without an open folder, they report that and write nothing. Turning off closes review, loads empty state, stops watchers/timer, and clears rows, badges, and Review resources.

Live settings are `srmd.enabled`, `srmd.rollover`, `srmd.inactive.front`/`back`, `srmd.suffixes`, `srmd.queueOrder`, `srmd.extensions`, and the formatting settings `srmd.format.*`. Extension names select bundled implementations. Manifest schemas define valid values; invalid values are logged and replaced with defaults. Settings are reread when workspace folders change. Changes enqueue a reload, recreate an open review document so current display settings apply, and refresh Markdown previews, except a change of formatting settings alone, which applies at the next format.

### Loading, watching, and concurrency

Load matching notes, parse once, build scheduler notes, persist resolved hints, and update state. Retain scheduling/tree relationships; reread bodies for review. Minimize startup work: count the empty state before loading, so each note's queues are built once, when it is created, and the count after loading rebuilds them only if loading crossed the rollover. Normalization conditions alone never trigger writes.

The shared workspace (see "Workspace") parses, inserts and persists; this host lists notes with `findFiles`, watches them and recounts every minute. Serialize state changes as workspace tasks: loads/switches, watcher batches, review selection, rating/save, recounts. Include file I/O; exclude waiting for ratings. Debounce watcher reports into one task. Record modification times after writes; skip unchanged versions in watcher batches.

Watch note contents and all path creation/deletion; folder events may omit descendants. Reconcile disk type and loaded state:

| Disk result        | Action                                                                                                                 |
|--------------------|------------------------------------------------------------------------------------------------------------------------|
| Missing path       | Remove its note or all notes below the deleted folder.                                                                 |
| Folder             | Relist/load matching notes and remove loaded notes absent from that listing, including a note replaced by this folder. |
| File               | Remove descendants of any folder it replaced; load it if its suffix matches, otherwise ignore it.                      |
| Other read failure | Keep previous state, log, and retry on the next reported change.                                                       |

Confirm absence only on `FileNotFound`, or `FileNotADirectory` beneath a replacement file. Follow symlinks; test type bits (`File | SymbolicLink`).

Refresh counts after filesystem changes/reviews and every minute, regardless of view visibility.

### Review and persistence

Review uses the selected note/folder. The loop below is the shared workspace's `next_card()` and `rate()`; the tab reports dropped ratings and failed saves. Without a scope, as from the Command Palette, a quick pick lists `review_scopes()` with their counts and refills on every keystroke; its rows set `alwaysShow`, since VS Code's own label filter matches only runs and would hide fuzzy matches.

1. **Select:** Read the selected note and compare it with `Note.version`. If changed, reload from that text and select again.
2. **Present:** Retain the shown source and parse; send the prepared card to the review tab.
3. **Rate:** Reread the note. If it differs from the shown source, drop the rating with a warning, reload, and continue from the new text.
4. **Save:** Compute `rated()` without mutating state and write the result. Every rating, FSRS or fixed-interval, is saved with `serialize()`; only hints resolved while loading use `persist_hints()`. Only after success call `apply()`, update the note version to the written text, and publish counts. Failed saves leave memory unchanged and the card due.

Selection, display, or save failure reports an error and closes review.

One review tab: changing scope retitles/reveals it and abandons the shown card unrated. **srmd: Show Note**, in the tab's title bar, tab menu and webview menu, shows the shown card's note with the cursor on its first cloze: in the group whose tab has it open, otherwise in a new tab beside the review. Finish any pending save before selecting from the new scope. Same-scope requests only reveal; closing ends review.

### Webview

Document: CSP disallowing inline scripts, stylesheets, empty container with `data-config` (`UIConfig`), bundled reviewer script. Send cards after `ready`; resend the current card after document reloads.

Card messages carry id, compiled controls, the reviewed card's ordinal, and note-folder `<base>` for relative resources. Translate URLs as required. Each card gets a fresh root/listeners; accept only its first rating with the matching id.

Load `reviewer-vscode.css` after shared styles. It maps `--sr-*` to VS Code theme variables and button/input/section-header metrics. The default choice is primary, other controls secondary, and intervals muted second lines. VS Code leaves `UIConfig.night_mode` off.

### Markdown preview

Activation exports `extendMarkdownIt` (manifest `markdown.markdownItPlugins`) for VS Code's built-in preview, a reading view of notes. Notes render through the preview's own markdown-it, so other extensions' syntax, such as Foam's links and embeds, and VS Code's front matter, highlighting and scroll sync apply. The preview parses text without naming its document, caches the tokens, and renders them with `env.currentDocument`. The plugin therefore records each token array's source in `parse()` and decides in `renderer.render()`: while srmd is on, a document whose path ends in a note suffix is transcribed with `srmd.extensions` (`transcribe()`) and parsed again in the render's environment, which plugins such as footnotes carry from parse to render. Anything else renders as before. Settings changes run `markdown.preview.refresh`.

The marks are three characters of a fixed set of non-ASCII punctuation that the note lacks. During that second parse only, a core rule right after inline parsing, before linkify and typography:

- splits text at the marks into span tokens, balanced per inline token, and drops the filler;
- drops paragraphs left blank, as the review drops those holding only explicit markers, and the `___` stand-ins;
- wraps each block cloze's blocks in div tokens: the block starting on its first line at its markdown-it level (two per enclosing list, one per quote), then that container's following blocks starting by its end line.

Spans and divs carry the review's `cloze` class, `data-ordinal` and `data-card`. linkify's `matchAtStart()` stops at a mark, since URL paths may contain punctuation.

`media/preview.css` (manifest `markdown.previewStyles`) hides no cloze and outlines every `.cloze[data-card]` with a faint gray border: inline clozes stay in their line, block clozes frame their blocks.

Embedded notes, which Foam renders without naming their document, keep their srmd syntax. srmd syntax inside another plugin's syntax that the parser does not know, such as math, loses its marks; turn on `foam-placeholders` so wiki links are units for the parser too.

### Formatting notes

While srmd is on, `formatter.ts` registers a document formatting provider for the paths ending in a note suffix (`**/*.sr.md`, glob characters of a suffix in brackets), so Format Document and format on save run `format()` with `srmd.extensions` and the formatting settings on notes, while other Markdown files keep their formatters. It returns one edit replacing the text, which VS Code reduces to the lines that changed. A note `format()` refuses keeps its text, and a warning and the log name it. Changed suffixes register the provider again, and turning srmd off unregisters it.

### Tree and Explorer

The Flashcards view (`srmd.notes`, its title translated) mirrors scheduler display order. Its single, initially expanded root uses the workspace folder name. Include every matching note, even without cards, and its ancestor folders. Rows use resource URIs as ids and resources, inheriting file icons, decorations, and tooltips; they set no separate tooltip. Show `d<n> • n<n> • l<n>` beside names; folder totals include all descendants.

Rows carry no command, so browsing the view never opens a note and shows its answers; a click selects a note and expands or collapses a folder. Every row has a **Review** button, notes also an **Edit** button, which opens the note as a normal tab in the active editor group. The row menu repeats both and adds **Reveal in Explorer**. Enter reviews the selected row and Ctrl+Enter edits it; these bindings act on the view's selection. While visible, the view selects the active editor's note without taking focus, so editing a note keeps both views on it; the Explorer follows the editor by itself. Nothing selects in the Explorer from the Flashcards view, since that API moves focus there.

Explorer decoration priority for notes with cards and their ancestors is red (`🔴`) when due, blue (`🔵`) when new, then green (`🟢`) when all later. Empty nodes have no count decoration. Leave text color unset except for problems below. Tooltips add `due: <n> • new: <n> • later: <n>`. The resource menu offers **srmd: Review** for nodes containing cards; the prefix is in the title because menus omit command categories.

### Problems and logging

The **srmd** output channel logs unreadable/unparseable notes, failed hint writes, invalid settings, stopped reviews, dropped ratings, multi-root limitations, and each note problem as `path: text`.

Problems include definitions serialization would discard and invalid calendar dates. Surface them through:

- A warning with **Show Log** after loading finds problems, and after a watcher/reload finds a newly affected note.
- `⚠ ` before tree counts for affected notes and ancestors.
- A `⚠` Explorer badge and `list.warningForeground`, overriding count badges even for a note without cards. Tooltips list note problems or the ancestor's affected-note count below counts.
- `ReviewData.notices` above the reviewed note.

Warnings never trigger normalization or automatic correction; persistence follows the review flow above.

## Android host

[apps/android/ARCHITECTURE.md](apps/android/ARCHITECTURE.md): a Kotlin shell around one WebView, which runs a web app on the shared components. The shell provides the notes folder through the Storage Access Framework, a message channel, Back, insets and lifecycle events; the web app views, reviews, edits and formats notes, with `shared/workspace` loading and saving them. Without file watching, it scans the folder at start, after long absences and on request, and reads single files whenever they are shown, reviewed or saved.

## Localization

`shared/l10n/` uses [Paraglide](https://paraglidejs.com). `project.inlang/settings.json` lists locales; `messages/<locale>.json` contains all shared/host messages with prefixes such as `reviewer_*`, `ui_*`, `workspace_*`, `vscode_*` and `android_*`.

`scripts/compile.mjs` uses the npm-installed message-format plugin, avoiding a CDN dependency, and generates typed functions in ignored `src/paraglide/`. Components import `m`; keys and placeholders are typechecked, e.g. `m.reviewer_days({ count })`. l10n, reviewer, UI, workspace, VS Code and Android test/typecheck/build scripts compile messages first.

Hosts call `set_language()` at startup. Module-state locale fallback: exact locale → language (`sv-SE` → `sv`) → English; missing messages use English. HTML callers escape verbatim placeholders. No hard-coded user-facing text.

VS Code selects `vscode.env.language`; manifests use `package.nls.json` and `package.nls.<locale>.json`, copied into the VSIX. Add a language to `locales`, its shared message file, its manifest message file, and the Android shell's `res/values-<locale>/strings.xml`. Webviews receive labels through `UIConfig` and need no separate message catalog.

Android's web app selects the device language the shell reports at start; the shell itself has one message, for an outdated WebView, as an Android string resource.

## Development

Each shared component has `package.json`, `tsconfig.json`, `src/`, and `tests/`. Parser, scheduler, reviewer, and workspace typecheck without DOM libraries. Tests use Node's runner and direct TypeScript imports through `tsx`.

`npm test` runs the current component; in `shared/` it runs all six. The repository root runs optional extensions, shared components, then VS Code and Android. `apps/vscode/tests/` run the production bundles, which `pretest` builds; so do the Android web app's browser tests, in headless Chromium with a mock shell. The Android shell's Kotlin unit tests run with Gradle (`npm run test:native` in `apps/android/`). See [tests/README.md](tests/README.md) for commands and boundaries.

## Known limitations

- Only the first multi-root workspace folder is loaded; log when others are present.
- VS Code's inherited-decoration indicator can replace explicit folder badges/tooltips when providers such as Git propagate decorations. The stable API cannot force srmd's aggregate badge to win; enabling its own propagation also produces the generic indicator. The Flashcards view retains complete counts.
- Any note edit while a card is shown invalidates its rating, even if the cloze is unchanged. Reconciliation is deferred.