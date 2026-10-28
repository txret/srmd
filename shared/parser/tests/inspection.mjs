#!/usr/bin/env node
/** Read-only pipeline inspector: source -> parse -> render, with an explicit serialization preview. */
import { readFile } from 'node:fs/promises'
import { parse, serialize, render } from '../src/index.ts'

const help = `Usage: npm run inspect -- [options] [note.md|-]

Read a note from a file or stdin. The default report shows parse() and render() without normalization.
  --json            Report as JSON, including live-event snapshots
  --serialize       Also preview serialization and a reparse of its output
  --source          Only serialized Markdown (explicit normalization)
  --html            Only HTML compiled from the original parsed event stream
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
  else if (mode === 'html') process.stdout.write(render(parsed.events))
  else {
    /**
     * Make inspectable JSON instead of serializing tokenizer contexts (which
     * contain parser state/functions). This snapshot cannot be fed to render().
     * text is a source slice; rendered_text is what an opener renders.
     * @param note - A live result from parse().
     * @returns Original source, scheduling, event snapshots and rendered HTML.
     */
    const snapshot = note =>
      /*
       * 1. Retain the note's source and stored scheduling.
       * 2. Replace live event contexts with inspectable token positions, source slices
       *    and cloze/card annotations.
       * 3. Render the live events and include their HTML alongside the snapshot.
       */
      ({
        source: note.source,
        scheduling: note.scheduling,
        events: note.events.map(([kind, token]) =>
          /*
           * 1. Copy the event kind, token type, source positions and original source slice.
           * 2. Include the token's ordinal, reference, replacement text and scheduling only
           *    when those annotations exist.
           */
          ({
            kind, type: token.type,
            start: { offset: token.start.offset, line: token.start.line, column: token.start.column },
            end: { offset: token.end.offset, line: token.end.line, column: token.end.column },
            text: note.source.slice(token.start.offset, token.end.offset),
            ...(token._ordinal === undefined ? {} : { card_ordinal: token._ordinal }),
            ...(token.type === 'cardReference' ? { ref: token.ref } : {}),
            ...(token._value === undefined ? {} : { rendered_text: token._value }),
            ...(token._scheduling === undefined ? {} : { scheduling: token._scheduling })
          })),
        html: render(note.events)
      })
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
        process.stdout.write(`\n=== ${stage}(): events ===\n`)
        for (const event of result.events) {
          // Print half-open source ranges; enter/exit lines share token bounds.
          const card = event.card_ordinal === undefined ? '' : ` card=${event.card_ordinal}`
          const reference = event.ref === undefined ? '' : ` ref=${event.ref}`
          process.stdout.write(`${event.kind.padEnd(5)} ${event.type} [${event.start.offset}, ${event.end.offset})${card}${reference} ${JSON.stringify(event.text)}\n`)
        }
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
