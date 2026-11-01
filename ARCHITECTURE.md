# srmd architecture

[SYNTAX.md](SYNTAX.md) defines syntax, note HTML, and serialization. This document covers components and integration. Simple note editing takes priority over retaining scheduling after substantial edits.

## Code base

`shared/` contains platform-independent behavior; `apps/` handles host UI and filesystem integration. Parser, scheduler, reviewer and workspace need no DOM or host services; UI serves HTML-based reviewers. Each component has its own `src/`, `tests/`, `package.json` and `tsconfig.json`; `shared/index.ts` exports them for hosts.

| Location              | Responsibility                                                                                                                           |
|-----------------------|------------------------------------------------------------------------------------------------------------------------------------------|
| `shared/parser/`      | srmd's markdown-it plugin and own instance: syntax, reference matching, note rendering, serialization. No scheduler or UI dependency.    |
| `shared/scheduler/`   | FSRS, hints, due-day balancing, queues, note/folder tree and counts.                                                                     |
| `shared/reviewer/`    | Rendered note, interval previews, choices, rating mappings, notices, review scopes. No files, DOM, or host callbacks.                    |
| `shared/ui/`          | HTML controls, DOM interaction, shortcuts, search, `UIConfig`. Optional for hosts using their own controls.                              |
| `shared/l10n/`        | Shared and host translations.                                                                                                            |
| `shared/workspace/`   | Loading, reviewing and saving a folder's notes over a host's file access; the settings hosts share; a tree of all files.                 |
| `apps/vscode/`        | VS Code settings, file search and watching, review tab, tree, decorations, and Markdown preview.                                         |
| `apps/android/`       | Android app: a Kotlin shell around one WebView running the web app; see [apps/android/ARCHITECTURE.md](apps/android/ARCHITECTURE.md).    |
| `foam/`               | The Foam repository as a git submodule, pinned to a commit; the Android app bundles parts of it (see "Foam in the Android app").         |

## Parser

### API and data flow

| API                                   | Contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
|---------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `parse(source, md?)`                  | One markdown-it parse of the note's text, the source without a byte order mark and with `\n` line endings, with an instance recording positions: srmd's own by default, or one with srmd's plugin and `positions` among others. Returns the source and the text, the tokens and instance, scheduling in card order, records with their offsets into the text, hint definitions, and definition problems; leaves hints unresolved.                                                                |
| `render(parsed, options?)`            | Renders the tokens with the parse's instance; `options.scheduling` replaces the cards shown.                                                                                                                                                                                                                                                                                                                                                                                                     |
| `serialize(parsed, scheduling)`       | Returns the note with references and definitions rewritten from the parse's records, in the source's line endings and byte order mark. No reparse, parse mutation, or I/O.                                                                                                                                                                                                                                                                                                                       |
| `persist_hints(parsed, scheduling)`   | Replaces hint state/due fields only; inserts due if absent.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `srmd_plugin(md, options?)`           | Adds srmd's syntax, cloze rule and renderer rules, and only those, to another instance, such as VS Code's preview's. They act on a parse whose environment carries `env.srmd`, which `parse()` sets and hosts set for what they render as a note or inside one. With `options.positions` it also records the source positions saving needs and reads front matter and link reference definitions as metadata blocks, for an instance of srmd's own, such as the one VS Code's reviews compose.   |
| `shared_markdown_it()`                | srmd's own instance, created once, which `parse()` uses by default: markdown-it's defaults, with HTML, and srmd recording positions. It reads cards; hosts render with instances of their own.                                                                                                                                                                                                                                                                                                   |

markdown-it records only line ranges on block tokens, so `track_positions()` (`positions.ts`) wraps the rules of the instance's block tokenize loop to record, after each rule that matched, the spans of the block tokens it pushed and maps from paragraph and table cell content back to the source, and notes where each inline token was pushed. The cloze rule (`clozes.ts`), a core rule right after inline parsing and before linkify and typography, walks the tokens once, adding cloze tokens, recording cards, references and definitions with their offsets, and placing each card's reference at its first cloze's syntactical end ([SYNTAX.md](SYNTAX.md#card-references)); `cards.ts` then matches references and definitions to the cards. The modules' comments describe how.

`ParsedNote.hints` retains matched hint definitions. `ParsedNote.problems` records orphaned/duplicate definitions with reference and line for host warnings. Parsing has no clock, randomness, workspace state, FSRS, or I/O.

Callers supply a parse with one valid scheduling record per card, in ordinal order. Hosts validate external settings/scheduling; internal APIs assume valid records. Empty Markdown is valid.

### Source layout

All paths below are under `shared/parser/src/`.

| File             | Responsibility                                                                                                           |
|------------------|--------------------------------------------------------------------------------------------------------------------------|
| `index.ts`       | Public parse/render pipeline.                                                                                            |
| `instance.ts`    | srmd's markdown-it instance and `srmd_plugin()`.                                                                         |
| `metadata.ts`    | The metadata blocks positions need: front matter and link reference definitions as tokens, a byte order mark dropped.    |
| `syntax.ts`      | Rules for markers, references, reference lines and definitions.                                                          |
| `positions.ts`   | Source spans of block and inline tokens, and source maps from paragraph and table cell content back to the source.       |
| `clozes.ts`      | The cloze rule: clozes and groups, reference positions and insertions, and the token lists with cloze tokens.            |
| `render.ts`      | Renderer rules for clozes, and for markers and metadata, which render nothing.                                           |
| `cards.ts`       | Reference matching and card record creation/formatting.                                                                  |
| `serialize.ts`   | `serialize()` and `persist_hints()`: edits of the note's text.                                                           |
| `types.ts`       | Shared parser records.                                                                                                   |
| `modules.d.ts`   | Types of markdown-it's link reference rule, which `metadata.ts` wraps.                                                   |

Hosts call parser APIs directly, without note adapters. The note inspector, [shared/parser/README.md](shared/parser/README.md), uses parser APIs only; no hint evaluation.

### Foam's syntax

srmd's plugin adds srmd's syntax only, and srmd's own instance reads none of Foam's. Foam's own markdown-it plugins render it: where [Foam](https://foambubble.github.io/foam/) is installed, in VS Code's preview and reviews (see "Markdown in reviews"), and in the Android app, from the Foam submodule (see "Foam in the Android app"). How the two syntaxes meet is [SYNTAX.md](SYNTAX.md#foam-syntax)'s.

## Scheduler

### State and API

Shared state retains parser timestamp/state spellings; FSRS conversion stays in the scheduler. `Card.ordinal` indexes cards/queues; `Card.ref` retains the card reference.

`State` holds notes, folders, counts, and settings; no scheduler-instance or host dependencies. Its prototype-free node dictionary accepts paths such as `constructor` and `__proto__`. Hosts may extend it or retain separate state. `Note`/`Folder` have typed card arrays/child paths. Notes store `problems` and `version` (parsed source); folders count descendant notes with problems.

| API                                                | Contract                                                                                                                                                                                  |
|----------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `Scheduler.create_note(path, parsed.scheduling)`   | Copies records, adds ordinals, resolves hints, records invalid dates, and returns `{ note, scheduling_changed }`. Leaves the parse unchanged.                                             |
| `load(root)`                                       | Resets the tree to an empty root.                                                                                                                                                         |
| `update()`                                         | Inserts/replaces notes while keeping each path exclusively a note or folder. Replacing a folder with a note removes its descendants; creating a needed folder replaces a blocking note.   |
| `notes_at(path)`                                   | The note at path, or every note below the folder at path, as hosts remove them.                                                                                                           |
| `rated(path, ordinal, rating, date)`               | Computes a rated copy without mutating state.                                                                                                                                             |
| `apply(path, card, date)`                          | Commits a card after persistence succeeds.                                                                                                                                                |
| `review()`                                         | Rates and commits together.                                                                                                                                                               |
| `peek()`                                           | Returns numeric interval previews (`Interval`: `{ unit, count }`), without translated labels.                                                                                             |
| `get_counts(node)`                                 | Aggregates due, new, and later cards for a note or folder.                                                                                                                                |

Display defaults belong to UI, and filename suffixes to hosts.

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

`review_scopes(state)` lists the notes and folders holding cards, with counts and problem flags, in display order, for choosing what to review.

`prepare_review()` renders the parse with the current scheduling, its instance's plugins rendering what they add, and supplies `ReviewData`: translated choices/details, interval previews, rating mappings, and `problem_text()` notices. Note output follows [SYNTAX.md](SYNTAX.md#html).

`compile_html()` inserts rendered note HTML and escapes titles, labels, choices, and notices. The title is the note's workspace-relative path; notices sit between title and note. `mount(root, ordinal, config)` marks the reviewed card's clozes `active` and hides the clozes the front does not show; hosts call it in the task that inserts the markup, so the browser cannot paint a cloze before it is hidden. It returns the card's controls, `search(open)` and `unmount()`, and reports ratings, followed wiki links and its search opening or closing as `sr-event` events. `UIConfig` supplies translated labels.

Styles use `--sr-*` for fonts, colors, and corner radius; `UIConfig.night_mode` enables the dark palette. Button descendants share click handling. Space/Enter activates the focused button before default shortcuts.

Initial scrolling uses the first active cloze, in this priority order:

1. Last preceding thematic break.
2. If nested the first cloze of its outermost parent group.
3. End of the preceding group's last cloze, if root-level with a preceding group.
4. Note start.

Search highlights overlay text without changing note DOM. `ResizeObserver` watches content/top-level blocks and schedules next-frame redraws on layout changes, including image loads and hidden clozes changing size. Disconnect on unmount.

## Workspace

`shared/workspace/` holds what every host does with a folder's notes, so all hosts load and save them alike: a difference would let one app damage what another wrote. Hosts supply file access, a `Storage` of `read()`, `write()` and optionally `load()`, a copy of a note's text the host checked against the file, used only for loading. They find the notes by listing, watching or scanning their folder, present the state, and extend `Workspace` or call it.

| API                                                 | Contract                                                                                                                                                                                                                                      |
|-----------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `run(task)`                                         | Serializes tasks: loads, change batches, review selection, rating saves, edits and recounts, including their file I/O.                                                                                                                        |
| `add(paths)`                                        | Loads, parses and inserts notes, eight reads in flight; persists resolved hints; returns how many have problems. Unreadable notes are logged.                                                                                                 |
| `apply(remove, load)`                               | Removes notes and reads others anew, then publishes counts, persists hints and announces new problems. An unreadable note keeps its state.                                                                                                    |
| `use(md)`                                           | Shows and saves cards with md from now on, an instance recording positions, as VS Code's reviews and the Android app use theirs. Notes always load with srmd's own instance, which reads cards.                                               |
| `reload(path, parsed)`, `is_current()`              | Replaces a note from a newer parse; whether a parse's text is `Note.version` and its cards the note's, by reference in ordinal order.                                                                                                         |
| `next_card(scope)`                                  | Selects a card and rereads its note with the instance in use; a changed note, or one that instance reads other cards in, is reloaded from that parse and selection repeats. `prepare()`, a host's hook, readies what the card's render reads. |
| `rate(card, rating)`                                | Rereads the note with the card's instance: changed, the rating is dropped and the note reloaded; else saved with `serialize()`, then committed.                                                                                               |
| `save_text(path, text, base)`                       | Saves an edit unless the file no longer holds base, the text editing began from; a null base overwrites. A saved note is reloaded.                                                                                                            |
| `read_settings(get, invalid)`                       | Validates the settings hosts share, under VS Code's names: suffixes, queue order, rollover, inactive clozes. Invalid values default.                                                                                                          |
| `file_kind()`, `folder_children()`, `tree_rows()`   | A tree of every file of a listing, notes and folders with the scheduler's counts, in display order (`compare_siblings()`).                                                                                                                    |

`WorkspaceEvents.refreshed()` publishes counts after each recount and `problems(count)` announces notes newly having problems. Log messages are `workspace_*` texts.

### Foam in the Android app

Foam (`foam/`, a git submodule pinned to a commit of [foambubble/foam](https://github.com/foambubble/foam)) supplies what the Android app renders Foam's syntax with: foam-core and the preview pipeline of Foam's VS Code extension, `createFoamMarkdownIt()`. The app builds them as Foam's web build does (`apps/android/scripts/rollup_foam.mjs`): `@foam/core` from foam-core's TypeScript source, only as far as the app uses it, its dependencies declared free of side effects; Foam's query renderer as a module adding nothing, as a query needs every file's metadata, which the app reads only for the files a shown one links to; lodash as lodash-es; `fs`, from which Foam's embed plugin reads embedded notes, as the app's cache of texts read beforehand, and `vm`, which only trusted JavaScript queries use, as a module that refuses. TypeScript, whose settings are stricter than Foam's, reads foam-core's declarations, built from the submodule with Foam's own TypeScript (`npm run build:foam`, before every Android build and typecheck), and declarations of the pipeline's options (`foam_preview_types.d.ts`); Node, as in tests, runs foam-core's build and the pipeline's sources. foam-core is the Android app's `file:` dependency on the submodule, so npm installs its dependencies at Foam's own versions.

## VS Code host

### Files and configuration

| File              | Responsibility                                                                                                |
|-------------------|---------------------------------------------------------------------------------------------------------------|
| `extension.ts`    | Compose modules and register commands; export the markdown-it plugin.                                         |
| `settings.ts`     | Read settings, validated with `read_settings()`; write workspace enablement.                                  |
| `status.ts`       | Status bar item.                                                                                              |
| `workspace.ts`    | The shared `Workspace` with file search, watching, load progress and recounts.                                |
| `filesystem.ts`   | Adapt VS Code filesystem APIs.                                                                                |
| `review_panel.ts` | Single review tab and review loop over `next_card()` and `rate()`; opens linked files.                        |
| `reviewer.ts`     | Webview script: show each card, forward its first rating and clicked wiki links.                              |
| `preview.ts`      | srmd's markdown-it plugin, srmd's syntax only: for the Markdown preview, and with `review: true` for reviews. |
| `markdown.ts`     | The markdown-it reviews parse and render notes with, composed of every extension's plugins.                   |
| `pick.ts`         | Quick pick choosing what to review, of `review_scopes()`.                                                     |
| `tree.ts`         | srmd tree view.                                                                                               |
| `explorer.ts`     | Resource decorations, counts, and tooltips.                                                                   |

`srmd.enabled` defaults to `false`. Disabled activation shows only the status item: no search, watching, recount, rows, or decorations. `config.srmd.enabled` controls the Flashcards view and palette Review/Turn Off commands. Turn On, Turn Off, and `srmd.toggle` write the workspace setting; without an open folder, they report that and write nothing. Turning off closes review, loads empty state, stops watchers/timer, and clears rows, badges, and Review resources.

Live settings are `srmd.enabled`, `srmd.rollover`, `srmd.inactive.front`/`back`, `srmd.suffixes` and `srmd.queueOrder`. Manifest schemas define valid values; invalid values are logged and replaced with defaults. Settings are reread when workspace folders change. A change of what decides the notes, `srmd.enabled`, `srmd.suffixes` or the first workspace folder, enqueues a reload; others apply to the notes loaded, the scheduler's rebuilding every note's queues. Every change recreates an open review document so current display settings apply, and refreshes Markdown previews.

### Loading, watching, and concurrency

Load matching notes, parse once, build scheduler notes, persist resolved hints, and update state. Retain scheduling/tree relationships; reread bodies for review. Notes load with srmd's own instance; reviews show and save cards with the instance they compose (see "Markdown in reviews"). Minimize startup work: count the empty state before loading, so each note's queues are built once, when it is created, and the count after loading rebuilds them only if loading crossed the rollover. Normalization conditions alone never trigger writes.

Activation starts the load and returns without waiting for it: VS Code's Markdown preview waits for the activation of every extension contributing markdown-it plugins, and srmd's plugin needs no loaded notes. Review waits for the tasks queued before it, the load among them.

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

Review uses the selected note/folder. The loop below is the shared workspace's `next_card()` and `rate()`; the tab reports dropped ratings and failed saves. Without a scope, as from the Command Palette, a quick pick lists `review_scopes()` with their counts, which VS Code's own filter narrows by label.

1. **Select:** Read the selected note, parsed with the reviews' instance, and compare it with `Note.version` and the note's cards. If the text changed, or the instance finds other cards than loading did, reload from that parse and select again.
2. **Present:** Retain the shown source and parse; send the prepared card to the review tab.
3. **Rate:** Reread the note, parsed with the shown card's instance. If it differs from the shown source, drop the rating with a warning, reload, and continue from the new text.
4. **Save:** Compute `rated()` without mutating state and write the result. Every rating, FSRS or fixed-interval, is saved with `serialize()`; only hints resolved while loading use `persist_hints()`. Only after success call `apply()`, update the note version to the written text, and publish counts. Failed saves leave memory unchanged and the card due.

Selection, display, or save failure reports an error and closes review. A wiki link clicked in the card opens its file in the editor (an `open` message); a placeholder opens nothing.

One review tab: changing scope retitles/reveals it and abandons the shown card unrated. **srmd: Show Note**, in the tab's title bar, tab menu and webview menu, shows the shown card's note with the cursor on its first cloze: in the group whose tab has it open, otherwise in a new tab beside the review. Finish any pending save before selecting from the new scope. Same-scope requests only reveal; closing ends review.

### Markdown in reviews

Reviews parse and render notes with a markdown-it instance of their own, composed as VS Code composes its Markdown preview's (`markdown.ts`), so what other extensions add to the preview, such as Foam's wiki links and embeds, shows in reviews too, and the cards a review shows and saves come from that same parse:

1. A dedicated instance with the options VS Code's preview creates its instance with before the extensions' plugins: HTML on, and links only with a scheme (`linkify.set({ fuzzyLink: false })`).
2. The installed extensions whose manifests declare `markdown.markdownItPlugins`, in the order of their ids, as VS Code promises none and plugins' rules can depend on it.
3. Each is activated, the others together, and its `extendMarkdownIt()` is called with the instance the previous one returned. srmd's own is called with `{ review: true }`: `srmd_plugin()` with `positions`, for saving, and without the preview's handling of documents and settings.
4. The workspace shows and saves cards with the result from the task selecting the first card on (`use()`); notes still load with srmd's own instance.

The instance is composed when the first review needs it, outside the workspace's tasks, and again after extensions change; every use sets `breaks`, `linkify` and `typographer` from `markdown.preview.*`, as the preview does at every render. A contributor that cannot be activated, whose hook throws, or whose hook returns no markdown-it instance is left out: each failure is logged, and one warning offers the log. A failure of srmd's own plugin stops the review. What VS Code adds to its preview's instance after the extensions' plugins is not part of it: code highlighting, front matter, which srmd's plugin hides, and its handling of links and images; nor are the extensions' preview scripts and stylesheets.

A note another extension embeds through the instance, as Foam renders embeds, is parsed while the reviewed note renders: srmd's plugin shows its clozes with ordinal 0 and no card, as the preview does.

### Webview

Document: CSP disallowing inline scripts, stylesheets, empty container with `data-config` (`UIConfig`), bundled reviewer script. Send cards after `ready`; resend the current card after document reloads.

Card messages carry id, compiled controls, the reviewed card's ordinal, and note-folder `<base>` for relative resources. Translate URLs as required. Each card gets a fresh root/listeners; accept only its first rating with the matching id.

Load `reviewer-vscode.css` after shared styles. It maps `--sr-*` to VS Code theme variables and button/input/section-header metrics. The default choice is primary, other controls secondary, and intervals muted second lines. VS Code leaves `UIConfig.night_mode` off.

### Markdown preview

Activation exports `extendMarkdownIt` (manifest `markdown.markdownItPlugins`) for VS Code's built-in preview, a reading view of notes, and for reviews (see "Markdown in reviews"). `srmd_plugin()` adds srmd's syntax, and only that, to the preview's own markdown-it, so other extensions' syntax and VS Code's front matter, highlighting and scroll sync apply to notes as to other documents. Its rules act only in a parse whose environment carries `env.srmd`, which only srmd sets, so other documents render as before. The preview parses text without naming its document, caches the tokens, and renders them with `env.currentDocument`. The plugin therefore records each token array's source in `parse()` and decides in `renderer.render()`: while srmd is on, a document whose path ends in a note suffix is parsed again in the render's environment with `env.srmd` set, with the scheduling of srmd's own `parse()`, whose definition matching needs the source positions only srmd's instance records. Anything else renders as before. Settings changes run `markdown.preview.refresh`.

With Foam installed, Foam's preview plugins render wiki links and embeds; without it, they are text. Foam renders an embedded note through the same markdown-it instance, so what is parsed while a note renders is Markdown it embeds: srmd's syntax applies, `embedded`, its clozes with ordinal 0.

`media/preview.css` (manifest `markdown.previewStyles`) hides no cloze and outlines every `.cloze[data-ordinal]` with a faint gray border: inline clozes stay in their line, block clozes frame their blocks.

### Tree and Explorer

The Flashcards view (`srmd.notes`, its title translated) mirrors scheduler display order. Its single, initially expanded root uses the workspace folder name. Include every matching note, even without cards, and its ancestor folders. Rows use resource URIs as ids and resources, inheriting file icons, decorations, and tooltips; they set no separate tooltip. Show `d<n> • n<n> • l<n>` beside names; folder totals include all descendants.

Rows carry no command, so browsing the view never opens a note and shows its answers; a click selects a note and expands or collapses a folder. Every row has a **Review** button, notes also an **Edit** button, which opens the note as a normal tab in the active editor group. The row menu repeats both and adds **Reveal in Explorer**. Enter reviews the selected row and Ctrl+Enter edits it; these bindings act on the view's selection. While visible, the view selects the active editor's note without taking focus, so editing a note keeps both views on it; the Explorer follows the editor by itself. Nothing selects in the Explorer from the Flashcards view, since that API moves focus there.

Explorer decoration priority for notes with cards and their ancestors is red (`🔴`) when due, blue (`🔵`) when new, then green (`🟢`) when all later. Empty nodes have no count decoration. Leave text color unset except for problems below. Tooltips add `due: <n> • new: <n> • later: <n>`. The resource menu offers **srmd: Review** for nodes containing cards; the prefix is in the title because menus omit command categories.

### Problems and logging

The **srmd** output channel logs a folder that cannot be listed, also with an error message, unreadable/unparseable notes, failed hint writes, invalid settings, stopped reviews, dropped ratings, multi-root limitations, and each note problem as `path: text`.

Problems include definitions serialization would discard and invalid calendar dates. Surface them through:

- A warning with **Show Log** after loading finds problems, and after a watcher/reload finds a newly affected note.
- `⚠ ` before tree counts for affected notes and ancestors.
- A `⚠` Explorer badge and `list.warningForeground`, overriding count badges even for a note without cards. Tooltips list note problems or the ancestor's affected-note count below counts.
- `ReviewData.notices` above the reviewed note.

Warnings never trigger normalization or automatic correction; persistence follows the review flow above.

## Android host

[apps/android/ARCHITECTURE.md](apps/android/ARCHITECTURE.md): a Kotlin shell around one WebView, which runs a web app on the shared components. The shell provides the notes folder through the Storage Access Framework, a message channel, Back, insets and lifecycle events; the web app views, reviews and edits notes, with `shared/workspace` loading and saving them and Foam's preview pipeline rendering them with srmd's plugin as its extension (see "Foam in the Android app"). Without file watching, it scans the folder at start, after long absences and on request, and reads single files whenever they are shown, reviewed or saved.

## Localization

`shared/l10n/` uses [Paraglide](https://paraglidejs.com). `project.inlang/settings.json` lists locales; `messages/<locale>.json` contains all shared/host messages with prefixes such as `reviewer_*`, `ui_*`, `workspace_*`, `vscode_*` and `android_*`.

`scripts/compile.mjs` uses the npm-installed message-format plugin, avoiding a CDN dependency, and generates typed functions in ignored `src/paraglide/`. Components import `m`; keys and placeholders are typechecked, e.g. `m.reviewer_days({ count })`. l10n, reviewer, UI, workspace, VS Code and Android test/typecheck/build scripts compile messages first.

Hosts call `set_language()` at startup. Module-state locale fallback: exact locale → language (`sv-SE` → `sv`) → English; missing messages use English. HTML callers escape verbatim placeholders. No hard-coded user-facing text.

VS Code selects `vscode.env.language`; manifests use `package.nls.json` and `package.nls.<locale>.json`, copied into the VSIX. Webviews receive labels through `UIConfig` and need no separate message catalog. [README.md](README.md#translations) lists what adding a language takes.

Android's web app selects the device language the shell reports at start; the shell itself has one message, for an outdated WebView, as an Android string resource.

## Known limitations

- Only the first multi-root workspace folder is loaded; log when others are present.
- VS Code's inherited-decoration indicator can replace explicit folder badges/tooltips when providers such as Git propagate decorations. The stable API cannot force srmd's aggregate badge to win; enabling its own propagation also produces the generic indicator. The Flashcards view retains complete counts.
- Any note edit while a card is shown invalidates its rating, even if the cloze is unchanged. Reconciliation is deferred.
- Whether srmd's markers apply inside another plugin's syntax, such as math, depends on the order of the plugins' rules, and syntax found after inline parsing, such as Foam's wiki links, does not stop them (see "Foam's syntax"). Reviews show and save the cards of their own parse; in VS Code's preview the cards come from srmd's own parse, by ordinal, so a cloze the preview's parse misses or adds shifts the scheduling shown on later ones.
- A plugin that replaces markdown-it's block tokenize loop or inline state after srmd's in the reviews' instance would leave its parses without positions.