# Shared components

Each component owns `src/`, `tests/`, `package.json` and `tsconfig.json`:

| Component    | Responsibility                                                                                                              |
|--------------|-----------------------------------------------------------------------------------------------------------------------------|
| `parser/`    | srmd syntax on GFM, cloze/reference matching, note rendering and serialization; optional micromark extensions as parameters |
| `scheduler/` | Manual hints, due-day balancing, FSRS, note/folder state and review queues                                                  |
| `reviewer/`  | Review snapshots, plain-text choices and rating mappings                                                                    |
| `ui/`        | HTML controls, DOM interaction, display defaults, shortcuts and search                                                      |
| `workspace/` | Loading, reviewing and saving a folder's notes over a host's file access; the settings hosts share; a tree of all files     |

`shared/index.ts` is the aggregate API for hosts. Components can also be imported
individually. Parser, scheduler, reviewer and workspace do not require a DOM or host
services. UI is reusable by HTML-based reviewers, including browser and webview hosts.

The workspace runs the lifecycle below for a host: given a `Storage` with `read()`
and `write()`, its `add()` loads notes, `next_card()` and `rate()` review them, and
`save_text()` saves edits, as serialized tasks (`run()`). The steps below are what
those methods do; a host using the workspace calls them instead.

The parser returns stored scheduling unchanged, including manual hints. The
scheduler copies those records into state, resolves hints and adds card ordinals.
Cards keep the same fields, so rendering and saving require no conversion wrappers:

```ts
// Loading. Optional micromark extensions, as { syntax, html } pairs; the parse records them for rendering.
const parsed = parse(source, extensions)
// create_note() plus the parse's problems, with parsed.source as note.version.
const { note, scheduling_changed } = note_from_parse(scheduler, path, parsed)
scheduler.update([], [note])
if (scheduling_changed) {
  // Resolved hints: only their state and due fields change, so this is safe in a note with problems too.
  const markdown = persist_hints(parsed.source, parsed.hints, note.cards)
  // After the host wrote markdown, it is the note's version: the checks below then take it for the host's own write.
  note.version = markdown
}

// Review. The host reads the note again and parses that text, which written hints changed. Parsing here rather
// than after the write keeps loading to one parse per note.
const current = parse(text, extensions)
if (current.source !== note.version) {
  // Edited elsewhere: build and insert the note from current, as when loading, before choosing its card.
}
const review = prepare_review(scheduler, path, ordinal, current)
// review.notices lists the note's problems for the user.

// Rating: save first, commit after. Re-read the note and compare it with note.version first.
const card = scheduler.rated(path, ordinal, rating)
const markdown = serialize(current, note.cards.map(other => other.ordinal === card.ordinal ? card : other))
// After the host wrote markdown:
note.version = markdown
scheduler.apply(path, card)
```

`State` contains scheduler settings, notes, folders and counts. A host may extend
it or keep platform-specific state alongside it. Suffixes stay with the host, which
also sets each note's version; `UIConfig` belongs to UI. FSRS conversion stays inside scheduler.

Run `npm test` in `shared/` for all portable tests or in a component for its tests.
Each component also provides `npm run typecheck`. The same commands at the
repository root include the VS Code host.

From `parser/`, use `npm run inspect -- tests/examples/reordered.sr.md` to inspect
a note. The CLI and fixtures live in `parser/tests/`; it preserves hints unchanged.

See the [test guide](../tests/README.md) for filtering cases and the
[architecture](../ARCHITECTURE.md) for the complete behavior and component contracts.
