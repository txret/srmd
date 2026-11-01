# The note inspector

The parser implements the syntax of [SYNTAX.md](../../SYNTAX.md) on
[markdown-it](https://github.com/markdown-it/markdown-it); its API and design are in
[ARCHITECTURE.md](../../ARCHITECTURE.md#parser), and how it works is in its modules' comments. The inspector shows how
a note parses, renders and would be saved, without changing it.

Install workspace dependencies once at the repository root. From this directory:

```sh
npm run inspect -- tests/examples/reordered.sr.md
npm run inspect -- --serialize tests/examples/positioning.sr.md
npm run inspect -- path/to/note.md
cat path/to/note.md | node --import tsx tests/inspection.mjs
```

From the repository root, `npm run parse -- path/to/note.md` runs the same inspector.

The default report shows the note as given, the in-memory scheduling, the srmd records (markers, clozes, references and
definitions with their offsets into the parsed text, the text itself, card and position), each card's position and
insertion, and the HTML. It does not serialize. Add `--serialize` to inspect what a save would write and a reparse of
it as a separate preview. `--json` reports the same as JSON.

```sh
node --import tsx tests/inspection.mjs --json path/to/note.md
node --import tsx tests/inspection.mjs --serialize --json path/to/note.md
node --import tsx tests/inspection.mjs --source path/to/note.md > saved.md
node --import tsx tests/inspection.mjs --html path/to/note.md > preview.html
```

The inspector reads files without modifying them. `--source` and `--html` emit only the requested output, so they can
be redirected. Manual hints and compact local timestamps remain as written; inspection makes no scheduling decisions,
which the scheduler's tests cover.
