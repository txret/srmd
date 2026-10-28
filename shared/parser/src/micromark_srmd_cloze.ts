/**
 * Micromark constructs and resolver for srmd clozes (SYNTAX.md, "Markers and groups", "Inline and block scope").
 *
 * Marker tokenizers recognize openers (`::`, `:;`, `::>`, `:;>`, ...) and closers (`<::`, `<:;`, ...) in text. A
 * tokenizer seeing `::` cannot know whether its answer is the rest of the text or the next block, so
 * resolve_clozes() decides with the whole event stream, in one walk adding a cloze token's enter and exit events
 * around each answer: an inline cloze renders as an HTML span, a block cloze as a div. Markers stay in the stream:
 * an implicit opener renders as a colon, explicit markers render nothing, and a marker that opens or closes
 * nothing, or stands in a heading, becomes ordinary text.
 */
import type { CompileContext, Code, Effects, Event, Extension, HtmlExtension, Point, State, Token, TokenizeContext } from 'micromark-util-types'
import { markdownLineEndingOrSpace as is_space_or_eol, markdownSpace as is_space } from 'micromark-util-character'
import { new_card, serialize_card } from './cards'
import type { CardDefinition, CardReference, ClozeToken, Group, Scheduling } from './types'

// Markdown's characterEscape consumes a backslash and one punctuation character before another text construct
// can start there: \:: cannot open a cloze. It escapes one character, not a marker run: \::: leaves an unescaped
// ::, and \<:: escapes the closer's < but still leaves :: eligible as an opening marker.

/** A marker as tokenized; resolve_clozes() sets what an opener renders. */
export type MarkerToken = Token & {
  /** Marker symbols, colons and the optional final semicolon: the group's symbol count. */
  _level: number
  /** Ends in a semicolon: continues the latest group of the same level. */
  _continuation: boolean
  /** Ends in `>`: closed by a closing marker rather than by Markdown structure. */
  _explicit: boolean
  /** The rendered text: a colon, and for an inline answer the spaces after the marker; explicit markers none. */
  _value?: string
}

/**
 * Tokenize a cloze opener positioned at `:`: two or more symbols, colons with an optional final semicolon, then
 * `>` (explicit) or whitespace, a line ending or the end of the text (implicit). An implicit marker takes the
 * spaces after it, which separate it from its answer.
 * @param effects - Micromark's speculative token operations.
 * @param ok - Continue after the marker.
 * @param nok - Return a lone or unspaced colon run to ordinary text, as in `a:b` or `:::answer`.
 * @returns The initial tokenizer state.
 */
function tokenize_opener(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  /** Symbols counted so far, and whether the last is a semicolon. */
  let level = 0
  let semicolon = false
  let token: MarkerToken
  return start

  /** Open the marker at its first colon. */
  function start(code: Code): State | undefined {
    token = effects.enter('clozeOpen') as MarkerToken
    effects.consume(code)
    level = 1
    return run
  }

  /** Count colons; a semicolon ends the run as a continuation. */
  function run(code: Code): State | undefined {
    if (code === 58 /*:*/ || code === 59 /*;*/) {
      effects.consume(code)
      level++
      semicolon = code === 59
      return semicolon ? after : run
    }
    return after(code)
  }

  /** Classify the marker by what follows it: `>` makes it explicit, a boundary implicit. */
  function after(code: Code): State | undefined {
    if (level < 2) return nok(code)
    token._level = level
    token._continuation = semicolon
    token._explicit = code === 62 /*>*/
    if (token._explicit) {
      effects.consume(code)
      effects.exit('clozeOpen')
      return ok
    }
    return code === null || is_space_or_eol(code) ? spaces(code) : nok(code)
  }

  /** Take the spaces or tabs after an implicit marker. */
  function spaces(code: Code): State | undefined {
    if (is_space(code)) {
      effects.consume(code)
      return spaces
    }
    effects.exit('clozeOpen')
    return ok(code)
  }
}

/**
 * Tokenize a closing marker positioned at `<`: two or more symbols, colons with an optional final semicolon.
 * The symbols do not select a group; the marker closes the latest explicit cloze still awaiting one.
 * @param effects - Micromark's speculative token operations.
 * @param ok - Continue after the symbols.
 * @param nok - Roll back so HTML, autolinks and text can handle the `<`.
 * @returns The initial tokenizer state.
 */
function tokenize_closer(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  /** Symbols counted so far. */
  let count = 0
  return start

  /** Open the marker at `<`. */
  function start(code: Code): State | undefined {
    effects.enter('clozeClose')
    effects.consume(code)
    return run
  }

  /** Count colons; a semicolon ends the run. */
  function run(code: Code): State | undefined {
    if (code === 58 /*:*/ || code === 59 /*;*/) {
      effects.consume(code)
      count++
      return code === 59 ? after : run
    }
    return after(code)
  }

  /** Accept two or more symbols. */
  function after(code: Code): State | undefined {
    if (count < 2) return nok(code)
    effects.exit('clozeClose')
    return ok(code)
  }
}

/**
 * Register markers in Markdown text; Markdown decides where text, and so a marker, can occur.
 * @returns The syntax extension; resolve_clozes() runs after Markdown's own resolution.
 */
export function cloze_syntax(): Extension {
  return {
    text: {
      58: { name: 'clozeOpen', tokenize: tokenize_opener },
      60: { name: 'clozeClose', tokenize: tokenize_closer }
    }
  }
}

/**
 * Blocks: a pending opener's answer is the next one entering at its container's depth. A paragraph is entered
 * through its content wrapper; a table cell bounds the answers of its own openers.
 */
const blocks = new Set([
  'content', 'atxHeading', 'setextHeading', 'listOrdered', 'listUnordered', 'blockQuote', 'codeIndented',
  'codeFenced', 'htmlFlow', 'table', 'tableHead', 'tableBody', 'tableRow', 'tableHeader', 'tableData', 'thematicBreak'
])
const table_cells = new Set(['tableHeader', 'tableData'])
/** Texts an opener can end; one ending its text holds the next block. */
const texts = new Set(['paragraph', 'tableHeader', 'tableData'])
const headings = new Set(['atxHeadingText', 'setextHeadingText'])
/** Whitespace and card references, which leave an opener before them at the end of its text. */
const not_content = new Set(['lineEnding', 'linePrefix', 'lineSuffix', 'whitespace', 'cardReference'])

/** Whether an entered token is content of its text, as opposed to whitespace or a card reference. */
function is_content(token: Token, source: string): boolean {
  if (not_content.has(token.type)) return false
  return token.type !== 'data' || source.slice(token.start.offset, token.end.offset).trim() !== ''
}

/** Whether only whitespace and card references follow the marker exiting at index, up to the end of its text. */
function at_text_end(events: Event[], index: number, source: string): boolean {
  for (let i = index + 1; i < events.length; i++) {
    const [kind, token] = events[i]
    if (kind === 'exit' && texts.has(token.type)) return true
    if (kind === 'enter' && is_content(token, source)) return false
  }
  return true
}

/** A marker level's latest group: allocated with its first cloze, open while one of its clozes is. */
type MarkerGroup = { group?: Group; open: boolean }

/** An opener whose answer is pending, or open until it closes. */
type OpenCloze = {
  group: MarkerGroup
  explicit: boolean
  /** Block depth outside the opener's text; a pending opener's answer must start there. */
  parent_depth: number
  /** Markdown depth the cloze opened at; it closes there at the latest. */
  depth: number
  token?: ClozeToken
  /** Ended by a closing marker or a hard break; it closes once Markdown nesting returns to depth. */
  closing: boolean
  /** The closing marker's end, where the cloze ends in the source. */
  closer?: Point
}

/**
 * Resolve committed Markdown into balanced cloze events and record card metadata on the parser state.
 * @param events - Fully expanded, balanced events from micromark postprocess().
 * @param context - Their document context with initialized card_state.
 * @returns The original events with cloze enters and exits added, in render order.
 */
export function resolve_clozes(events: Event[], context: TokenizeContext): Event[] {
  /*
   * Walk the events once, copying them to the result and adding cloze events:
   * - an exit first closes the clozes opened inside the exiting token: an answer cannot outlive it;
   * - a block entering where a pending opener waits gets a block cloze around it;
   * - a hard break closes the implicit inline clozes before it;
   * - an opener opens an inline cloze after it, or at the end of its text becomes pending: its answer is the
   *   next block in its container; a closer marks the latest explicit cloze still awaiting one as closing;
   * - after each exit, the clozes ready to close at the new depth close: implicit block clozes after their
   *   block, closing ones once Markdown nesting allows.
   * Definitions and references are recorded on the parser state; srmd syntax in headings becomes text.
   */
  const state = context.parser.card_state
  const source = state.source
  const result: Event[] = []
  /** The latest group opened at each marker level, which continuations of that level join. */
  const groups_by_level: { [level: number]: MarkerGroup | undefined } = {}
  /** Clozes whose answer has started and not ended, innermost last. */
  const open: OpenCloze[] = []
  /** An opener at the end of its text, waiting for the next block in its container to be its answer. */
  let pending: OpenCloze | undefined
  /** Blocks entered and not exited: a pending opener's answer must start at its parent's depth. */
  let block_depth = 0
  /** Markdown tokens entered and not exited: a cloze closes before the token it opened in exits. */
  let depth = 0
  /** Quotes and lists entered and not exited: definitions outside them are root-level. */
  let containers = 0
  /** In heading text, where srmd syntax is literal. */
  let heading = false
  /** Whether the paragraph being walked renders anything so far; reset at its enter, read at its exit to hide it. */
  let visible = false
  /** The reference line being walked, recorded on its references for saving. */
  let line: Token | undefined

  /** Open a cloze: allocate the card with its group's first cloze, and add the cloze's enter. */
  const open_cloze = (entry: OpenCloze, type: 'inlineCloze' | 'blockCloze', start: Point): void => {
    /* A continuation reuses its group's card; a first cloze creates the group. */
    const group = entry.group.group
    const ordinal = group?.ordinal ?? state.groups.length + 1
    const scheduling = group?.scheduling ?? new_card(-ordinal)
    const cloze: ClozeToken = { type, start, end: start, _ordinal: ordinal, _scheduling: scheduling }
    if (!group) {
      entry.group.group = { ordinal, first_cloze: cloze, scheduling, nesting: 0 }
      state.groups.push(entry.group.group)
    }
    entry.group.open = true
    entry.token = cloze
    result.push(['enter', cloze, context])
    open.push(entry)
  }

  /** Close the innermost cloze, at its closing marker if it had one. */
  const close_cloze = (end: Point): void => {
    const entry = open.pop()!
    entry.token!.end = entry.closer ?? end
    if (entry.closer) entry.token!._closer_end = entry.closer.offset
    entry.group.open = false
    result.push(['exit', entry.token!, context])
  }

  /** Close the innermost clozes ready to close at depth at. */
  const close_ready = (end: Point, at: number): void => {
    while (open.length) {
      const entry = open[open.length - 1]
      if (entry.depth !== at || !(entry.closing || (!entry.explicit && entry.token!.type === 'blockCloze'))) return
      close_cloze(end)
    }
  }

  for (let i = 0; i < events.length; i++) {
    const event = events[i]
    const [kind, token] = event
    const entering = kind === 'enter'
    /** The depth outside an entering token, inside an exiting one. */
    const outer = depth
    depth += entering ? 1 : -1

    // Before the event: clozes it ends close, and a block cloze opens around a pending opener's answer.
    if (!entering) {
      while (open.length && open[open.length - 1].depth >= outer) close_cloze(token.end)
    } else if (blocks.has(token.type)) {
      // Metadata, such as definitions after an opener, is not an answer.
      const answer = token.type !== 'content' || events[i + 1][1].type === 'paragraph'
      if (pending?.parent_depth === block_depth && answer) {
        // A continuation whose group was reopened meanwhile has nothing left to answer.
        if (!pending.group.open) {
          pending.depth = outer
          open_cloze(pending, 'blockCloze', token.start)
        }
        pending = undefined
      }
      block_depth++
    } else if (token.type === 'listItemPrefix') {
      // Micromark has no list-item exit: the next item's prefix ends the previous item, with its pending
      // opener and the clozes opened in it.
      if (pending && pending.parent_depth >= block_depth) pending = undefined
      while (open.length && open[open.length - 1].depth >= outer) close_cloze(token.start)
    } else if (token.type === 'hardBreakEscape' || token.type === 'hardBreakTrailing') {
      for (const entry of open) {
        if (!entry.explicit && entry.token!.type === 'inlineCloze') entry.closing = true
      }
      close_ready(token.start, outer)
    }
    result.push(event)

    // The event itself: metadata, structure that later events depend on, and markers.
    if (entering) {
      if (token.type === 'cardDefinition') {
        (token as CardDefinition).root = containers === 0
        state.definitions.push(token as CardDefinition)
      } else if (token.type === 'cardReferenceLine') {
        line = token
      } else if (token.type === 'cardReference') {
        if (heading) token.type = 'data'
        else {
          if (line) (token as CardReference).line = line
          state.references.push(token as CardReference)
        }
      } else if (token.type === 'paragraph') {
        visible = false
      } else if (token.type !== 'clozeOpen' && token.type !== 'clozeClose' && is_content(token, source)) {
        visible = true
      }
    } else if (token.type === 'clozeOpen') {
      const marker = token as MarkerToken
      const group = heading ? undefined : marker._continuation ? groups_by_level[marker._level] : { open: false }
      if (!heading && !marker._continuation) groups_by_level[marker._level] = group
      // A marker in a heading is text, as is a continuation with no group to continue or inside its own group's cloze.
      if (!group || group.open) token.type = 'data'
      else {
        const block = at_text_end(events, i, source)
        const entry: OpenCloze = { group, explicit: marker._explicit, parent_depth: block_depth - 1, depth, closing: false }
        // An implicit opener shows a colon, followed by the spaces it took when an inline answer follows them on
        // its line; an explicit one shows nothing.
        const spaces = /[ \t]*$/.exec(source.slice(token.start.offset, token.end.offset))![0]
        const answer_follows = !block && !/^[\r\n]?$/.test(source[token.end.offset] ?? '')
        marker._value = marker._explicit ? '' : answer_follows ? ':' + spaces : ':'
        if (block) pending = entry
        else open_cloze(entry, 'inlineCloze', token.end)
      }
      if (token.type === 'data' || marker._value) visible = true
    } else if (token.type === 'clozeClose') {
      // A closer ends the latest explicit cloze still awaiting one; one waiting for Markdown takes no other.
      let entry: OpenCloze | undefined
      for (let c = open.length - 1; c >= 0 && !heading && !entry; c--) {
        if (open[c].explicit && !open[c].closing) entry = open[c]
      }
      if (entry) {
        entry.closing = true
        entry.closer = token.end
      } else {
        token.type = 'data'
        visible = true
      }
    } else if (token.type === 'cardReferenceLine') {
      line = undefined
    } else if (token.type === 'paragraph') {
      if (!visible) token.type = 'clozeEmptyParagraph'
    }
    if (headings.has(token.type)) heading = entering
    if (token.type === 'blockQuote' || token.type === 'listOrdered' || token.type === 'listUnordered') {
      containers += entering ? 1 : -1
    }

    // After an exit: a pending opener inside the block can no longer get an answer, and ready clozes close.
    if (!entering) {
      if (blocks.has(token.type)) {
        block_depth--
        if (pending && pending.parent_depth >= (table_cells.has(token.type) ? block_depth : block_depth + 1)) pending = undefined
      }
      close_ready(token.end, depth)
    }
  }
  // Only document-level explicit clozes can remain after all Markdown exits.
  while (open.length) close_cloze(events[events.length - 1][1].end)
  return result
}

/**
 * Render clozes and their markers, and drop paragraphs that render nothing.
 * @param scheduling - Optional valid cards in ordinal order, one per card.
 * @returns HTML handlers for resolved cloze events, without scheduling validation.
 */
export function cloze_html(scheduling?: readonly Scheduling[]): HtmlExtension {
  /**
   * Open a cloze element with the card ordinal and the canonical definition of its card; the definition keeps
   * the in-memory reference, independent of the ordinal.
   */
  function enter_cloze(this: CompileContext, token: Token): undefined {
    const cloze = token as ClozeToken
    const element = token.type === 'blockCloze' ? 'div' : 'span'
    const card = scheduling ? scheduling[cloze._ordinal - 1] : cloze._scheduling
    // Definition fields use attribute-safe characters only.
    this.tag(`<${element} class="cloze" data-ordinal="${cloze._ordinal}" data-card="${serialize_card(card)}">`)
  }
  return {
    enter: {
      inlineCloze: enter_cloze,
      blockCloze: enter_cloze,
      /**
       * Buffer a paragraph rendering nothing until its exit discards it: its children, such as line endings and
       * whitespace, would still print.
       */
      clozeEmptyParagraph(this: CompileContext) {
        this.buffer()
      }
    },
    exit: {
      /** Write an opener's colon; explicit markers write nothing. */
      clozeOpen(this: CompileContext, token: Token) {
        this.raw(this.encode((token as MarkerToken)._value ?? ''))
      },
      inlineCloze(this: CompileContext) {
        this.tag('</span>')
      },
      blockCloze(this: CompileContext) {
        this.tag('</div>')
      },
      /** Discard the paragraph buffered by the matching entry handler. */
      clozeEmptyParagraph(this: CompileContext) {
        this.resume()
      }
    }
  }
}
