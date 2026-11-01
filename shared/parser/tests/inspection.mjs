#!/usr/bin/env node
/** Read-only pipeline inspector: source -> parse -> render, with an explicit serialization preview. */
import { readFile } from 'node:fs/promises'
import { parse, serialize, render } from '../src/index.ts'

const help = `Usage: npm run inspect -- [options] [note.md|-]

Read a note from a file or stdin. The default report shows parse() and render() without normalization.
  --json            Report as JSON, including the srmd records
  --serialize       Also preview serialization and a reparse of its output
  --source          Only serialized Markdown (explicit normalization)
  --html            Only HTML rendered from the original parse
  --help            Show this help

Files are read only. Redirect --source explicitly to save a normalized copy.
`

try {
  const args = process.argv.slice(2)
  let filename = '-'
  let mode = 'report'
  let preview_serialization = false
  // Select output modes and the input path; this tool never resolves scheduling hints.
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--help') {
      process.stdout.write(help)
      process.exit(0)
    } else if (arg === '--serialize') preview_serialization = true
    else if (['--json', '--source', '--html'].includes(arg)) mode = arg.slice(2)
    else if (arg.startsWith('-') && arg !== '-') throw new Error(`Unknown option: ${arg}`)
    else if (filename !== '-') throw new Error('Supply one note path, or use stdin')
    else filename = arg
  }
  // Buffer stdin completely: parsing needs the entire document and its EOF.
  // File input and stdin then go through exactly the same API calls below.
  const source = filename === '-'
    ? await new Promise((resolve, reject) => {
      /*
       * 1. Accumulate stdin chunks in their arrival order.
       * 2. Resolve the complete UTF-8 source on end, or reject on an input error.
       */
      const chunks = []
      process.stdin.on('data', chunk =>
        /*
         * Append this stdin chunk so the completed source retains arrival order.
         */
        chunks.push(chunk))
      process.stdin.on('end', () =>
        /*
         * Join buffered chunks, decode UTF-8, and resolve the complete Markdown source.
         */
        resolve(Buffer.concat(chunks).toString('utf8')))
      process.stdin.on('error', reject)
    })
    : await readFile(filename, 'utf8')
  const parsed = parse(source)
  // Single-output modes omit all report headings, making redirection usable.
  if (mode === 'source') process.stdout.write(serialize(parsed, parsed.scheduling))
  else if (mode === 'html') process.stdout.write(render(parsed))
  else {
    /**
     * Make inspectable JSON of a parse: its source, scheduling and srmd records, each with its range and text in the
     * parsed text, rather than markdown-it's tokens, which hold the instance. This snapshot cannot be fed to render().
     * @param note - A result from parse().
     * @returns Original source, scheduling, records and rendered HTML.
     */
    const snapshot = note => {
      /*
       * 1. Retain the note's source and stored scheduling.
       * 2. List each record kind in text order: clozes with their card ordinals, markers, references with their
       *    identifiers and positions, definitions, and each card's position and insertion.
       * 3. Render the parse and include its HTML alongside.
       */
      const range = record => ({
        start: record.start.offset, end: record.end.offset, text: note.text.slice(record.start.offset, record.end.offset)
      })
      return {
        source: note.source,
        scheduling: note.scheduling,
        records: [
          ...note.clozes.map(cloze => ({ kind: `${cloze.kind} cloze`, ...range(cloze), card: cloze.ordinal })),
          ...note.markers.map(marker => ({ kind: 'marker', ...range(marker) })),
          ...note.references.map(reference => ({ kind: 'reference', ...range(reference), ref: reference.ref, position: reference.key })),
          ...note.definitions.map(definition => ({ kind: 'definition', ...range(definition), ref: definition.scheduling.ref }))
        ].sort((left, right) => left.start - right.start || right.end - left.end),
        cards: note.groups.map(group => ({ card: group.ordinal, position: group.key, insertion: group.insertion, ref: group.reference?.ref })),
        html: render(note)
      }
    }
    const report = { parse: snapshot(parsed) }
    // Serialization and its diagnostic reparse are opt-in work, never required
    // for simply loading or rendering a note. The CLI still never writes files.
    if (preview_serialization) {
      const markdown = serialize(parsed, parsed.scheduling)
      report.serialize = { ...snapshot(parse(markdown)), changed: markdown !== source }
    }
    if (mode === 'json') process.stdout.write(JSON.stringify(report, null, 2) + '\n')
    else {
      // The same fields/order are printed for both stages for direct comparison.
      for (const stage of Object.keys(report)) {
        const result = report[stage]
        process.stdout.write(`\n=== ${stage}(): Markdown ===\n${result.source}\n`)
        process.stdout.write(`\n=== ${stage}(): scheduling ===\n${JSON.stringify(result.scheduling, null, 2)}\n`)
        process.stdout.write(`\n=== ${stage}(): records ===\n`)
        for (const record of result.records) {
          // Print half-open source ranges.
          const card = record.card === undefined ? '' : ` card=${record.card}`
          const reference = record.ref === undefined ? '' : ` ref=${record.ref}`
          const position = record.position === undefined ? '' : ` position=${record.position}`
          process.stdout.write(`${record.kind} [${record.start}, ${record.end})${card}${reference}${position} ${JSON.stringify(record.text)}\n`)
        }
        process.stdout.write(`\n=== ${stage}(): cards ===\n`)
        for (const card of result.cards) process.stdout.write(`${JSON.stringify(card)}\n`)
        process.stdout.write(`\n=== render(${stage}): HTML ===\n${result.html}\n`)
      }
      if (report.serialize) process.stdout.write(`\nSerialization changes source: ${report.serialize.changed}\n`)
    }
  }
} catch (error) {
  // Keep diagnostics off stdout so redirected Markdown/HTML/JSON is not mixed
  // with errors, and signal failure to shell scripts with a nonzero exit code.
  process.stderr.write(`parser: ${error.message}\n`)
  process.exitCode = 1
}
