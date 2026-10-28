# srmd for Android: architecture

[SYNTAX.md](../../SYNTAX.md) defines the note format and [ARCHITECTURE.md](../../ARCHITECTURE.md) the shared
components and the rules every host follows, notably loading, review and persistence. This document covers what the
Android host adds and how it uses the shared code. [README.md](README.md) describes the app for its users.

The app's uses, in priority order:

1. **Viewing** the knowledge base: a file full screen, rendered with every cloze shown.
2. **Reviewing** cards, as in the VS Code review tab.
3. **Editing** files as Markdown or text, with CodeMirror.

## Principles

- **A thin native shell around one WebView.** Kotlin provides only what a web page cannot: the user's notes folder,
  its picker, persistent settings, Back, system insets, lifecycle events and intents to other apps. Every screen is
  HTML in one WebView, written in TypeScript on the shared components, so behavior matches the VS Code host and 
  browser host can reuse it.
- **Notes stay plain files in a folder the user picks**, synced by their own tool such as Syncthing or Git. The app
  has no service and works offline. It writes a note only to save a review, a resolved hint or an edit the user
  confirmed, and never overwrites a change it has not read (see "Data flow").
- **No app framework.** No Cordova, Capacitor or Compose: an Activity, a WebView, `androidx.activity`,
  `androidx.core` and `androidx.webkit`. The web app is bundled with Rollup like the VS Code webview; CodeMirror is
  its only runtime dependency beyond the shared components.

## Screen and interaction

```text
 Main view                           Drawer, swiped out over the note
+--------------------------------+   +------------------------------------+-------+
|                                |   | v notes          d1 * n4 * l2 [>]  |       |
| The note, full screen:         |   |   > biology      d0 * n2 * l0 [>]  | the   |
| view, edit or review mode      |   |   v topic        d1 * n2 * l0 [>]  | note, |
|                                |   |       a.sr.md    d1 * n1 * l0 [>]  | dim-  |
|                                |   |       diagram.png                  | med   |
|                                |   |       readme.md                    |       |
|                                |   |     plain.txt                      |       |
+--------------------------------+   +------------------------------------+       |
| [search in note     ] 2/7 ^ v  |   | [search all files              ]   |       |
|  ==== handle: swipe up ====    |   | [eye | md]  [review]  [settings]   |       |
+--------------------------------+   +------------------------------------+-------+
```

### Modes of the main view

| Mode   | Shows                                                                                         | Entered by                                                     |
|--------|-----------------------------------------------------------------------------------------------|----------------------------------------------------------------|
| View   | The file rendered: Markdown and notes with every cloze shown and outlined, text preformatted. | Opening a file; leaving edit or review                         |
| Edit   | The file's text in CodeMirror; Markdown and srmd syntax highlighted in Markdown files.        | The Markdown symbol in the drawer                              |
| Review | The shared reviewer: the note with the card's clozes hidden, its choices below.               | A tree row's Review button, or the drawer's for the shown note |

The drawer's toggle shows the eye in edit mode and the Markdown symbol otherwise, switching the shown file between
view and edit mode; in review it edits the reviewed note. Review ends on the last reviewed note in view mode.

### Gestures

| Gesture                                                 | Action                                                                |
|---------------------------------------------------------|-----------------------------------------------------------------------|
| Swipe right on the main view                            | Opens the drawer, following the finger                                |
| Swipe left on the drawer, or tap the dimmed note        | Closes the drawer                                                     |
| Swipe up from the handle strip at the bottom, or tap it | Opens the search of the shown file                                    |
| Vertical drag elsewhere                                 | Scrolls; never opens anything                                         |
| Tap a link                                              | Opens the linked file (see "Files") over the shown one, a URL outside |
| Tap a row                                               | Opens the file (see "Files"); expands or collapses a folder           |

A sideways touch drags the drawer only once it moved 12 px, clearly more sideways than up or down, and only when it
did not start in an element that scrolls sideways, such as a wide table or code block. Lifting the finger leaves the
drawer open past half its width, or as a fling's direction says. Swipes from the screen edges belong to Android's
Back and Home gestures. CSS gives sideways movement to these handlers (`touch-action: pan-y`), so they listen
passively and scrolling is never delayed.

### Back

Everything opened over the shown file forms one stack, in opening order, and Back closes the last one; with nothing
open, Android handles Back and leaves the app.

| Open                      | Back                                                            |
|---------------------------|-----------------------------------------------------------------|
| A dialog                  | Answers it as its cancelling choice does, such as Keep editing. |
| The settings page         | Closes it.                                                      |
| A search in the drawer    | Clears it: the whole tree shows again.                          |
| The drawer                | Closes it.                                                      |
| The search of the file    | Closes it with its highlights.                                  |
| Review                    | Ends it: view mode on the note reviewed last.                   |
| Edit mode                 | Leaves it, asking whether to save a change (see "Edit").        |
| A file opened from a link | Shows the file with the link again, where it was scrolled.      |

Opening a file from the drawer, and starting a review, close everything first, so they start over; an edit with a
change asks before it closes. The page tells the shell whenever whether anything is open changes, so Android's
predictive Back animates leaving the app only when nothing is.

### Drawer

- **Tree.** The notes folder and every file below it, except skipped names (see "Settings"): folders first, names
  ignoring case and comparing numbers by value, as in the VS Code Flashcards view. Notes show `d<n> • n<n> • l<n>`, and
  folders holding notes the counts of all notes below them; other files show none. `⚠` marks notes with problems and
  their folders. Rows with due or new cards have a Review button. The shown file's row is selected and revealed.
  Expanded folders are kept for the next start.
- **Search all files**, below the tree. The tree shows only the files whose path contains every word of the query or
  whose text contains the whole query, ignoring case, with their folders expanded; a file matching in its text shows
  its number of matches.
- **Bottom bar**: the view/edit toggle, Format for the Markdown file being edited, Review for the shown note, and the
  settings cogwheel.

### Files

| File                                              | Opens                                                       |
|---------------------------------------------------|-------------------------------------------------------------|
| Note: a configured suffix, `.sr.md` by default    | In the app, as Markdown with clozes; reviewable             |
| Markdown: `.md`, `.markdown` and other extensions | In the app, as Markdown with clozes, which are not reviewed |
| Text: `.txt`, `.csv`, `.json`, `.yaml` and others | In the app, as plain text                                   |
| Any other file, such as an image or PDF           | In the Android app for its type, through an `ACTION_VIEW`   |

Markdown files render with the same parser as notes, srmd included, so a cloze in a plain Markdown file shows
outlined too. Every file that opens in the app can be edited.

### Settings

A page of the web app. Each control applies as soon as it changes, when valid:

- the notes folder, chosen with the system's folder picker, and **Rescan now** with the last scan's result;
- note suffixes, the Markdown and text extensions opened in the app, and the names skipped (`.*`, hidden files, and
  `node_modules` by default; `*` stands for any characters);
- the review settings of the VS Code host: when the review day starts, the order of the queues, inactive clozes on
  the front and back, and the optional Markdown extensions;
- its formatting settings: how paragraph lines wrap and at which width, list numbering and bullets, table delimiter
  rows, and the delimiters of emphasis and strong emphasis;
- the log: notes skipped, failed writes, dropped ratings and invalid settings.

## Components

```text
+------------------------------ Android shell (Kotlin) ------------------------------+
| MainActivity --- WebView --- WebViewAssetLoader                                    |
|   |               |            +- /app/...    AppHandler: the web app's assets     |
|   |               |            +- /notes/...  ResourceHandler --+                  |
|   |               +- "srmd" message channel --- Bridge ----------+- NoteStorage    |
|   +- Back callback, insets, lifecycle                              (Storage Access |
|   +- folder picker --- SettingsStore                                Framework)     |
+------------------------------------------------------------------------------------+
                                          | JSON messages
+-------------------------- web app (TypeScript, one page) --------------------------+
| main --- App --+- NoteView, ReviewView, Editor (CodeMirror)                        |
|                +- Drawer: TreeView, search_files()                                 |
|                +- NoteSearch, SettingsView, Dialog, gestures                       |
|                +- Library --- Workspace (shared) --- AndroidStorage --- Bridge     |
| shared: parser, scheduler, reviewer, ui, l10n, workspace                           |
+------------------------------------------------------------------------------------+
```

### Native shell (Kotlin, `native/`)

The package is `io.github.txret.srmd`. Kotlin code follows Kotlin's naming, camelCase; the web app follows the
repository's snake_case.

| File                 | Responsibility                                                                                                        |
|----------------------|-----------------------------------------------------------------------------------------------------------------------|
| `MainActivity.kt`    | The window: one WebView edge to edge; Back, insets and lifecycle events; the folder picker; intents to other apps.    |
| `Bridge.kt`          | The message channel: decodes requests, answers them on the right thread, sends events. `Host` is what it needs.       |
| `NoteStorage.kt`     | The notes folder through the Storage Access Framework: scan, read, write, and paths mapped to documents.              |
| `ResourceHandler.kt` | The page's origin: the web app from the APK's assets under `/app/`, the notes folder's files under `/notes/`.         |
| `SettingsStore.kt`   | The notes folder's URI and the web app's settings as JSON, in `SharedPreferences`.                                    |
| `Messages.kt`        | The message format: requests decoded, replies, errors and events encoded.                                             |
| `Paths.kt`           | Workspace-relative paths checked against leaving the folder, skip patterns, UTF-8 decoding without a byte order mark. |

`MainActivity`:

- `onCreate()`: draws edge to edge; stops with a message when the WebView lacks web message listeners; restores the
  notes folder while its access is still granted; configures the WebView (JavaScript and DOM storage on, file and
  content access off, mixed content never, pinch zoom); routes requests through `WebViewAssetLoader`; registers the
  `Bridge` for the app's origin only; loads `https://appassets.androidplatform.net/app/index.html`.
- Back: an `OnBackPressedCallback`, enabled while the page reports something open, sending the `back` event; the
  manifest enables predictive Back.
- `onPause()` / `onResume()`: send `pause` and `resume` with the time away.
- The insets listener sends the system bars' insets, or the keyboard's while it shows and is taller, in CSS pixels.
- `pickRoot()`: `ActivityResultContracts.OpenDocumentTree`, then `takePersistableUriPermission` for reading and
  writing, giving up the previous folder's access.
- `openFile()` and `openUrl()`: `ACTION_VIEW` intents, granting the receiving app read access to a file.
- Rotation and keyboards do not recreate the activity; a change between light and dark mode does, so the page follows.

`NoteStorage`, every call off the UI thread:

```kotlin
data class FileEntry(val path: String, val mtime: Long, val size: Long)
data class FileText(val text: String, val mtime: Long, val size: Long)
data class Stat(val mtime: Long, val size: Long)

/** Every file below the root, one query per folder, skipping names matching a pattern. */
fun scan(skip: List<String>): List<FileEntry>
/** The text, decoded as UTF-8, with the time and size it had; reread when the file changed while it was read. */
fun read(path: String): FileText
/** Replace the text; refused as `conflict` when expectedMtime is given and the file's time differs. */
fun write(path: String, text: String, expectedMtime: Long?): Stat
/** The file's document; refused as `not_found` when there is none below the root. */
fun document(path: String): Uri
```

Paths are the workspace-relative, slash-separated paths of the shared code (`topic/a.sr.md`). `scan()` records each
path's document ID, so later calls resolve a path without walking the tree; a path it did not list, or whose ID went
stale because a sync replaced the file, is looked up name by name. Paths with empty names, `.` or `..` resolve to
nothing, so neither a request nor the page's resource URLs reach outside the folder. Writes truncate (`wt`, or `rwt`
where a provider lacks it), never plain `w`, which some providers leave the old end of.

### Web app (TypeScript, `src/`)

| Module              | Responsibility                                                                                                  |
|---------------------|-----------------------------------------------------------------------------------------------------------------|
| `main.ts`           | Starts the app: connects the bridge, asks for settings, folder, language and insets, opens the cache.           |
| `bridge.ts`         | Typed requests with promised replies; event subscriptions; `BridgeError` with the shell's code.                 |
| `cache.ts`          | IndexedDB: the texts of files read, with their times and sizes, and a few values kept between starts.           |
| `storage.ts`        | `AndroidStorage`: the shared `Storage` over the bridge, loading from the cache while the scan shows it current. |
| `library.ts`        | `Library`: scans, loads notes into the shared `Workspace` and applies rescans; reads shown files.               |
| `library_search.ts` | `search_files()`: the drawer search's matches by path and text.                                                 |
| `settings.ts`       | The stored settings, their defaults and validation; lists typed into fields.                                    |
| `app.ts`            | `App`: the shown file, the stack of layers Back closes, and the flows between views.                            |
| `note_view.ts`      | `NoteView`: a file in view mode; where links lead (`link_target()`).                                            |
| `review_view.ts`    | `ReviewView`: one card at a time in the shared reviewer controls.                                               |
| `editor.ts`         | `Editor`: CodeMirror with Markdown and srmd highlighting, the note search's matches, and formatting.            |
| `tree_view.ts`      | `TreeView`: the drawer's rows (see `tree_rows()`), taps delegated.                                              |
| `drawer.ts`         | `Drawer`: slid out, hidden or following a finger, with its scrim.                                               |
| `note_search.ts`    | `NoteSearch`: the bar searching the shown file: the shared `Search` in view mode, the editor's in edit.         |
| `settings_view.ts`  | `SettingsView`: the settings page.                                                                              |
| `dialog.ts`         | `Dialog`, questions with a few answers, and `Toast`, short messages.                                            |
| `gestures.ts`       | The swipes above, from passive touch events.                                                                    |
| `icons.ts`          | The buttons' icons, as inline SVG.                                                                              |
| `media/`            | The page, `index.html`, and its layout and theme, `app.css`; the reviewer styles come from shared/ui.           |

`App` holds the screen's state and is the only place it changes; the views render. What is open forms one stack, so
Back needs no rules of its own:

```ts
type Layer =
  | { kind: 'dialog'; cancel: string }
  | { kind: 'settings' }
  | { kind: 'drawer' }
  | { kind: 'drawer_search' }
  | { kind: 'note_search' }
  | { kind: 'review'; scope: string; card: PreparedCard | null }
  /** base: the file's text when editing began, which saving compares with the file. */
  | { kind: 'edit'; path: string; base: string }
  /** from_scroll: where the file shown before was scrolled, restored by Back. */
  | { kind: 'link'; path: string; from_scroll: number }

class App {
  readonly layers: Layer[]
  /** View, review or edit, by the topmost review, edit or link layer, else the shown file; empty without one. */
  mode(): Mode
  /** From the drawer: closes everything and shows the file; from a link: opens a link layer over the shown file. */
  open(path: string, options?: { link?: boolean; fragment?: string; query?: string }): Promise<void>
  review(scope: string): Promise<void>
  toggle_edit(): Promise<void>
  /** Close the last layer opened, as Back does. */
  back(): Promise<void>
}
```

After every change of the stack, `App` sends `back.set` when whether anything is open changed.

### Shared code

| Component     | Use on Android                                                                                                         |
|---------------|------------------------------------------------------------------------------------------------------------------------|
| parser        | `parse()`/`render()` for view and review mode; editor highlighting from the parse's own tokens; `format()`.            |
| scheduler     | State, queues and counts for the tree and reviews, as in VS Code; `compare_siblings()` orders the tree's other files.  |
| reviewer      | `prepare_review()` through the workspace, `review_rating()`, `problem_text()`.                                         |
| ui            | `compile_html()`, `mount()`, `Search`, `UIConfig` and the reviewer styles, with the app's theme layer over them.       |
| l10n          | Every text of the web app, under `android_*` keys; the native shell's one message is an Android string resource.       |
| **workspace** | Loading, reviewing and saving notes over the `Storage` interface; the settings both hosts share; the file tree's rows. |

### The shared workspace component

Both apps must load and save notes the same way; a difference would mean one app damaging what the other wrote. The
logic the VS Code host had is in `shared/workspace/` (ARCHITECTURE.md, "Workspace"):

- from `workspace.ts`: the task queue, loading notes and persisting resolved hints, applying changes, reloading a
  changed note, and saving with the note's version;
- from `review_panel.ts`: selecting the next card and rereading its note, and saving a rating unless the note
  changed (`next_card()`, `rate()`);
- from `settings.ts`: the settings model and its validation (`read_settings()`).

The VS Code host extends the shared `Workspace` with its file search, watchers, progress notification and recount
timer, and keeps its views and review tab. Android uses it through `Library`. New for Android: `save_text()`, saving
an edit unless the file changed since editing began, and the file tree of all files (`file_kind()`,
`folder_children()`, `tree_rows()`).

## Interfaces

### Bridge messages

One channel, `srmd`, registered with `WebViewCompat.addWebMessageListener` for the app's origin only, so no other
page or frame can reach it. Messages are JSON. The page sends requests and receives replies with the same `id`:

```ts
type Request = { id: number; method: string; params?: object }
type Reply = { id: number; result: object } | { id: number; error: { code: ErrorCode; message: string } }
type ErrorCode = 'no_root' | 'not_found' | 'conflict' | 'denied' | 'no_app' | 'io'
```

| Method          | Params                            | Result                                 | Notes                                                       |
|-----------------|-----------------------------------|----------------------------------------|-------------------------------------------------------------|
| `app.start`     |                                   | `{ settings, root, language, insets }` | First request. `root` is `{ name }`, or null when unusable. |
| `settings.set`  | `{ settings }`                    | `{}`                                   | Stores the settings JSON.                                   |
| `root.pick`     |                                   | `{ root }`                             | The system folder picker; null when cancelled.              |
| `files.scan`    | `{ skip: string[] }`              | `{ entries: FileEntry[] }`             | Every file below the root, skipping matching names.         |
| `files.read`    | `{ path }`                        | `{ text, mtime, size }`                | Time and size asked before and after reading.               |
| `files.load`    | `{ path }`                        | `{ text }`                             | Content only, for notes a scan just listed.                 |
| `files.write`   | `{ path, text, expected_mtime? }` | `{ mtime, size }`                      | `conflict` when the file's time is not `expected_mtime`.    |
| `files.open`    | `{ path }`                        | `{}`                                   | The Android app for its type; `no_app` when none.           |
| `link.open`     | `{ url }`                         | `{}`                                   | A URL outside the app; `no_app` when none opens it.         |
| `back.set`      | `{ handled: boolean }`            | `{}`                                   | Enables or disables the native Back callback.               |
| `keyboard.show` |                                   | `{}`                                   | Shows the keyboard for the focused field, after a swipe.    |

`back.set`, `link.open`, `settings.set` and `keyboard.show` are answered on the UI thread as they arrive, so their
order holds; `root.pick` when the picker returns; everything reading or writing files on a pool of four threads, whose
replies return through the UI thread.

The shell sends events, `{ event: string; params: object }`, once the page has sent a request:

| Event    | Params                                   | Meaning                                                       |
|----------|------------------------------------------|---------------------------------------------------------------|
| `back`   |                                          | Back was pressed while the page reported something open.      |
| `resume` | `{ away: number }`                       | The app returned to the foreground after `away` milliseconds. |
| `pause`  |                                          | The app goes to the background: keep an edit's draft.         |
| `insets` | `{ top, bottom, left, right, keyboard }` | Insets in CSS pixels, applied as CSS variables.               |

### Storage and workspace

The shared workspace's file access, which Android implements over the bridge and VS Code over its file system API:

```ts
interface Storage {
  /** The file's current text. */
  read(path: string): Promise<string>
  write(path: string, text: string): Promise<void>
  /** The text to load a note from at start, such as a cached text the host checked against the file; read() without. */
  load?(path: string): Promise<string>
}
```

`AndroidStorage` keeps the text of every file it reads or writes in IndexedDB, with its time and size. `load()` returns
the cached text while the last scan shows the same time and size, so a start reads only changed notes, and those with
`files.load`: the content alone, paired with the scan's time and size, which saves the two provider queries `files.read`
makes around each read. As the scan came first, a file changed since pairs newer text with an older time, never the
reverse, so a write based on it is refused rather than saved over the change. `read()` always reads the file, and the
workspace reads a note again before showing its card and before saving a rating or an edit, so a cached text never
decides what is written. Every write names the time of the text it is based on, the last read or loaded for its path,
and the shell refuses it when the file changed since, as when a sync wrote it; this mostly guards resolved hints, which
are written from the text loaded at start.

```ts
class Workspace {
  constructor(storage: Storage, settings: WorkspaceSettings, log: Log, events: WorkspaceEvents)
  readonly state: State
  readonly scheduler: Scheduler
  /** Run a task after the earlier ones; every task that reads or writes notes or state runs as one. */
  run<T>(task: () => Promise<T>): Promise<T>
  /** Read, parse and insert notes with up to eight reads in flight; persist resolved hints. */
  add(paths: string[]): Promise<number>
  /** Remove notes and read changed ones, then publish counts, persist hints and announce new problems. */
  apply(remove: string[], load: Iterable<string>): Promise<void>
  /** The scope's next card, read and prepared for display; null when none is left. */
  next_card(scope: string): Promise<PreparedCard | null>
  /** Save a rating: 'saved', 'changed' when the note changed since its card was shown, or 'failed'. */
  rate(card: PreparedCard, rating: ReviewRating): Promise<RateResult>
  /** Save an edit made from base; 'changed' leaves a file that no longer holds base unwritten; null base overwrites. */
  save_text(path: string, text: string, base: string | null): Promise<'saved' | 'changed'>
}

interface WorkspaceEvents {
  /** Counts were recounted: the tree redraws. */
  refreshed(): Promise<void>
  /** count notes newly have problems (see ARCHITECTURE.md, "Problems and logging"). */
  problems(count: number): void
}
```

`Library` composes them for Android: its `scan()` lists the folder through the shell, then in one task either loads
every note into an emptied workspace (the first scan, or the first after settings changed which files are notes or
how they parse) or compares the listing with the storage's entries and applies the differences. Its `read()` reads a
file for showing and, for a loaded note whose text differs from its version, reloads it in the background.

### Tree rows

```ts
/** The folder structure of a listing: each folder's children in display order. */
function folder_children(files: FileEntry[]): Children
/** The visible rows: the root, then expanded folders' children; with matches, only those and their folders. */
function tree_rows(state: State, children: Children, root_name: string, kinds: (path: string) => FileKind,
  expanded: { [path: string]: boolean }, matches?: { [path: string]: number }): TreeRow[]
```

The scheduler's tree holds notes only; `tree_rows()` adds the other files of the listing and takes counts from the
scheduler's notes and folders.

### URLs

| URL                                                  | Serves                                                 |
|------------------------------------------------------|--------------------------------------------------------|
| `https://appassets.androidplatform.net/app/…`        | The web app, from the APK's `assets/web/`.             |
| `https://appassets.androidplatform.net/notes/<path>` | A file of the notes folder, through `ResourceHandler`. |

Before a file or a card is inserted, the page's `<base>` moves to `.../notes/<file's folder>/`, so relative images load
from the notes folder, as in the VS Code review tab. The page's own files use absolute paths. Its content security
policy allows scripts from the app only, styles from the app and inline (CodeMirror inserts its own), and images and
media from the app and `data:`. The APK requests no permissions, not even `INTERNET`: the web app and its libraries,
CodeMirror included, are bundled, so an image on the web shows as missing. Notes render without raw HTML, as in VS Code,
so a note cannot run script. Links never navigate the page: the app resolves them itself (`link_target()`), against the
file's folder, absolute paths against the notes folder, and only web, mail, phone and map links leave the app.

## Data flow

**Start.** `app.start` returns the settings, folder, language and insets. Without a usable folder, the settings page
opens with the folder picker. Otherwise the app shows the last session at once from IndexedDB: the last listing as the
tree, and an unsaved edit or the last file shown. A scan then loads the notes in the background, and the tree's counts
appear when it finishes.

**Scanning.** The Storage Access Framework cannot watch a folder, so changes made by a sync tool are found by
scanning: one query per folder, which lists names, types, times and sizes together. It never blocks the screen, but it
is not free, so the app scans only:

- at start;
- on returning to the foreground after at least 15 minutes away, since a sync probably ran meanwhile and Android
  can keep the app's process alive for days;
- after settings that change which files show or are notes;
- on **Rescan now**.

Single files are read when they matter, which is cheap: a file when it is shown and when the app returns to the
foreground, a note before a review shows its card and before a rating is saved, a file when edit mode begins and
before an edit is saved. So the shown file is always current, and a change is never overwritten. A note found changed
this way is reloaded, so its cards and counts follow. Counts are recounted every minute while the app is in the
foreground, as intraday cards become due.

**View.** `NoteView` renders Markdown and notes with `render(parse(text, extensions).events)` and the app's reader
styles: every cloze shown and outlined, as in the VS Code Markdown preview. Text files show preformatted. Wide tables
and code blocks scroll sideways inside the note. A link to a file of the folder opens it as in "Files", trying the
Markdown and note extensions when the link has none, as Foam writes them; a link to a fragment scrolls to it. Foam's
wiki links render as text, through the optional `foam-placeholders` extension.

**Review.** As the VS Code host's review loop (ARCHITECTURE.md, "Review and persistence"): `Workspace.next_card()`
in a task, `compile_html()` and `mount()`, the first rating saved through `Workspace.rate()` in a task, then the next
card. A rating for a note that changed meanwhile is dropped with a message; a failed save ends the review, leaving the
card due. When no card is left, review ends on the last note in view mode.

**Edit.** `Editor` opens the file's text, read anew, which becomes the edit layer's base; files using CRLF line breaks
keep them. Leaving edit mode with a change, by the toggle, Back or opening another file, asks: **Save**, **Discard** or
**Keep editing**. Saving goes through `Workspace.save_text()`, which compares the file with the base first; when the
file changed meanwhile, for instance by a sync, it is not overwritten: a second question offers **Overwrite it**,
**Discard my edit** or **Keep editing**, which leaves time to copy the text. A saved note is reloaded with its new
cards. On `pause` the editor's text is kept as a draft in IndexedDB, which is not saving: if Android ends the app, the
next start reopens edit mode with the draft, over the file it started from.

**Format.** In edit mode of a Markdown file, the drawer's Format, or Shift+Alt+F in CodeMirror, formats the text with
the shared `format()`, the file's extensions and the formatting settings. The editor applies the result as changes of
the lines that differ (`line_changes()`, a longest common subsequence of lines), so the cursor and search marks on the
others stay, in one step of the history that typing does not join. A toast says when the text is formatted already, or
when `format()` refused it, as it would render differently.

**Note search.** View mode uses the shared `Search`, which draws highlight boxes over the rendered file without
changing it; edit mode marks the matches in CodeMirror; review mode opens the reviewer's own search. The bar shows
which match of how many is current and moves between them both ways.

**Search all files.** `search_files()` matches the query against paths and against the texts the cache holds while
current. Files not read before are read in the background on the first search, the matches growing as they arrive.

## Layout, build and tests

```text
apps/android/
  ARCHITECTURE.md, README.md
  package.json, rollup.config.mjs, tsconfig.json   web app build: npm workspace @srmd/app-android
  src/                                             web app (TypeScript)
  media/                                           the page and its styles
  tests/                                           web app tests: Node, and a browser with a mock shell
  native/                                          Gradle project (Kotlin)
    app/build.gradle.kts                           Android 10 (API 29) and later; AndroidX activity, core, webkit
    app/src/main/AndroidManifest.xml
    app/src/main/kotlin/io/github/txret/srmd/       MainActivity, Bridge, NoteStorage, ResourceHandler, ...
    app/src/main/res/                              theme, launcher icon, the shell's strings (English)
    app/src/main/assets/web/                       the web build's output, ignored by Git
    app/src/test/kotlin/io/github/txret/srmd/       JVM unit tests
```

- `npm run build` in `apps/android/` compiles messages, typechecks and bundles the web app into
  `native/app/src/main/assets/web/`. `npm run apk` builds it, then the debug APK with Gradle, into
  `native/app/build/outputs/apk/debug/`. Gradle needs a JDK 17 or later with `javac` (`JAVA_HOME`) and the Android
  SDK (`ANDROID_HOME`, or `sdk.dir` in `native/local.properties`); the Android Gradle plugin installs the SDK platform
  and build tools it lacks.
- Web tests follow [tests/README.md](../../tests/README.md). `bridge`, `storage`, `library` and `views` test the
  parts that need no browser in Node. `app.test.mjs` runs the built web app in headless Chromium with
  `tests/mock_native.js`, a stand-in for the shell holding files in memory, and drives it by touch: swipes, taps,
  Back, settings and restarts. It is skipped when no Chromium is found; `CHROME` names one.
- `node tests/browser.mjs <folder>` serves a folder's notes to the built web app with the mock shell, for trying it in a
  desktop browser's device emulation.
- `npm run test:native` runs the Kotlin unit tests of paths, skip patterns and the message format with Gradle.
  Storage Access Framework access, Back and insets need a device or an emulator.

## Decisions

The questions this design left open, answered:

1. **The shared workspace component.** The VS Code host's loading, review and saving logic moved to
   `shared/workspace/`, and both hosts use it.
2. **Scanning on return.** After 15 minutes away, besides start, settings and Rescan now.
3. **Plain Markdown files** render with srmd, like notes; only notes are reviewed.
4. **Files opened in the app.** The common Markdown and plain-text extensions, editable in the settings.
5. **Wiki links** render as text for now; opening their notes needs a rendering extension resolving names to files.
6. **Folder access.** The Storage Access Framework, which works for any folder the picker offers, rather than the
   "All files access" permission, which would reach the whole device.
7. **Minimum Android version.** 10 (API 29); the WebView must support web message listeners, as any updated one does.
8. **Creating, renaming and deleting** files and folders: left out; the app's main use is reading the knowledge base.
9. **A file changed during an edit** is overwritten only when the user says so; the app creates no conflict copies.
