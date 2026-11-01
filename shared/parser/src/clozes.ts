/**
 * srmd's cloze rule, a markdown-it core rule run right after inline parsing (SYNTAX.md, "Clozes" and "Card
 * references"). A marker cannot know by itself whether its answer is the rest of the text or the next block, so the
 * rule decides with the whole token stream.
 *
 * It walks markdown-it's tokens once, in order: the block tokens, and each inline token's children where the inline
 * token stands. Every token enters and then exits: an opening token enters, its closing token exits, a self-contained
 * token does both. On the way the walk builds the new token lists: `srmd_cloze_open` and `srmd_cloze_close` tokens,
 * span or div, around each answer, markers that open or close nothing turned into text, and the paragraphs that render
 * nothing left out. It records cards, references and definitions with their source positions, and finds where each
 * card's reference belongs, its position, one of:
 * - `t<offset>`, the end of a text: an explicit cloze's follows its closing marker; an implicit inline cloze's ends the
 *   piece of its paragraph or table cell its opener is in, before the whitespace and references ending the piece; a
 *   block cloze whose last block is a paragraph ends that paragraph's text. These are syntactical ends: where rendering
 *   closes a cloze, as at the end of the emphasis or link it opened in, does not matter. A reference stands at the
 *   position it follows, past whitespace and other references: a closing marker's end, or a piece's content end.
 * - `l<offset>`, a reference line after the block starting at offset, in the same parent, with at most one blank line
 *   between: the position of a block cloze whose last block is not a paragraph. A reference line interrupts a paragraph,
 *   so after a list, quote or table it ends them, and lists and quotes are blocks like any other.
 * References are then matched to cards by position, and definitions to cards by identifier (see cards.ts).
 *
 * Terminology:
 * - depth: how many tokens the walk entered and has not exited, an inline token counting as one around its children.
 *   A cloze closes before the token it opened in exits, at the latest.
 * - block depth: how many blocks other than metadata the walk entered and has not exited. A pending opener's answer is
 *   the next block entered at the depth of the opener's container.
 * - text: the children of an inline token, the content of a paragraph, heading or table cell. Its pieces end at its
 *   hard breaks and at its end.
 * Offsets are into markdown-it's source, `state.src`, which is the parsed note's text (see parse()).
 */
import type { StateCore, Token } from 'markdown-it'
import { match_cards, new_card } from './cards'
import { span_to_source, type PositionedToken, type Span } from './positions'
import type { LineReference, MarkerMeta } from './syntax'
import type { CardDefinition, CardParserState, CardReference, Cloze, Group, Insertion, Point, SourceRange, SrmdEnv } from './types'

/** What the walk records besides the cards: every cloze, and the markers that open or close one. */
type Records = CardParserState & { clozes: Cloze[]; markers: SourceRange[] }

/** A marker level's latest group: allocated with its first cloze, open while one of its clozes is. */
type MarkerGroup = { group?: Group; open: boolean }

/** An opener whose answer is pending, or open until it closes. */
type OpenCloze = {
  group: MarkerGroup
  explicit: boolean
  /** Block depth outside the opener's text; a pending opener's answer must start there. */
  parent_depth: number
  /** Depth the cloze opened at; it closes there at the latest. */
  depth: number
  /** Ended by a closing marker or a hard break; it closes once nesting returns to depth. */
  closing: boolean
  /** The closing marker's end. */
  closer?: number
  /** Once it opens: its record, its closing token, and the token list both its tokens go in. */
  record?: Cloze
  close_token?: Token
  tokens?: Token[]
  /** The cloze's index among the note's clozes, in opening order. */
  index?: number
}

/** A block a reference can follow: its span, its kind, and for a paragraph where its text's content ends. */
type Block = { start: number; end: number; type: string; text_end?: number }

/**
 * A block being walked, as references are placed: the last block that ended directly in it, which a reference line
 * follows and a block cloze stands for, and the line where anything in it last ended.
 */
type Frame = { last?: Block; last_line: number }

/** What placing a text's references and inline clozes needs, collected as its children are walked. */
type Text = {
  inline: PositionedToken
  /** Where its hard breaks start. */
  breaks: number[]
  references: CardReference[]
  /** The ends of the closing markers in it, which a reference can follow. */
  closer_ends: Set<number>
  /** The inline clozes opened in it. */
  clozes: OpenCloze[]
}

/** Blocks whose text an opener can end, holding the next block. */
const texts = new Set(['paragraph', 'th', 'td'])
/** Table cells, which bound the answers of their own openers. */
const table_cells = new Set(['th', 'td'])
/** Blocks that are metadata: never a pending opener's answer, a cloze's last block or what a reference line follows. */
const metadata = new Set(['srmd_definition', 'srmd_reference_line', 'srmd_link_definition', 'front_matter'])
/** Blocks within other blocks that a reference line does not follow: list items and table parts. */
const inner_blocks = new Set(['list_item', 'thead', 'tbody', 'tr', 'th', 'td'])
/** Quotes and lists: definitions outside them are root-level. */
const containers = new Set(['blockquote', 'bullet_list', 'ordered_list'])
/** HTML blocks of kinds 1 to 5 end at their end condition; kinds 6 and 7 continue until a blank line. */
const self_ending_html = /^[ \t]*<(?:(?:script|pre|style|textarea)(?=[\s>]|$)|!--|\?|![A-Za-z]|!\[CDATA\[)/i

/**
 * The cloze rule (see the module comment).
 * @param state - markdown-it's core state after inline parsing, of a parse srmd syntax applies to: `state.env.srmd`
 *   receives the cards.
 */
export function cloze_rule(state: StateCore): void {
  /* Walk the tokens, then match references and definitions to the cards found. */
  const walk = new ClozeWalk(state.src, state.Token)
  state.tokens = walk.blocks(state.tokens as PositionedToken[])
  const { scheduling, hints, problems } = match_cards(walk.records)
  const env = state.env as { srmd: SrmdEnv }
  env.srmd.cards = { ...walk.records, scheduling, hints, problems }
}

/** The kind of block a block token opens, closes or is: its type without `_open` or `_close`. */
function block_type(token: Token): string {
  if (token.nesting === 1 && token.type.endsWith('_open')) return token.type.slice(0, -'_open'.length)
  if (token.nesting === -1 && token.type.endsWith('_close')) return token.type.slice(0, -'_close'.length)
  return token.type
}

/** Whether a child is content of its text, as opposed to whitespace, a soft line break or a reference. */
function is_content(token: Token): boolean {
  if (token.type === 'softbreak' || token.type === 'srmd_reference') return false
  return token.type !== 'text' || /\S/.test(token.content)
}

/** Whether only line breaks, whitespace and references follow the child at index, to the end of its text. */
function ends_text(children: Token[], index: number): boolean {
  for (let i = index + 1; i < children.length; i++) {
    if (children[i].nesting !== -1 && is_content(children[i])) return false
  }
  return true
}

/** Make a marker or reference that turned out literal ordinary text, as written. */
function to_text(token: Token): void {
  token.type = 'text'
  token.content = token.markup
}

/** How many of the ascending values are below a limit. */
function count_below(values: number[], limit: number): number {
  let low = 0
  let high = values.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (values[middle] < limit) low = middle + 1
    else high = middle
  }
  return low
}

/** The walk of the cloze rule (see the module comment): where it stands, and what it found. */
class ClozeWalk {
  /** The cards, references, definitions, clozes and markers found. */
  readonly records: Records = { groups: [], references: [], definitions: [], clozes: [], markers: [] }
  /** Where each line of the source starts, for line numbers. */
  private readonly lines: number[] = [0]
  /** The latest group opened at each marker level, which continuations of that level join. */
  private readonly groups_by_level: { [level: number]: MarkerGroup | undefined } = {}
  /** Clozes whose answer has started and not ended, innermost last. */
  private readonly open: OpenCloze[] = []
  /**
   * Explicit clozes of the text walked that the end of the inline element they opened in closed before their closing
   * marker: one still takes a closing marker later in the text, which its reference follows.
   */
  private clipped: OpenCloze[] = []
  /** An opener at the end of its text, waiting for the next block in its container to be its answer. */
  private pending: OpenCloze | undefined
  /** See the module comment. */
  private depth = 0
  private block_depth = 0
  /** Quotes and lists entered and not exited: definitions outside them are root-level. */
  private container_depth = 0
  /** In heading text, where srmd syntax is literal. */
  private heading = false
  /** Where the paragraph walked starts in its token list, and whether it renders anything so far. */
  private paragraph_at = 0
  private visible = false
  /** Where the content of the text walked last ends, for the paragraph holding it; undefined without content. */
  private text_end: number | undefined
  /** The blocks entered and not exited for placing references, the document first. */
  private readonly frames: Frame[] = [{ last_line: 0 }]
  /** Ends of implicit openers' symbols: a reference written there needs a space to keep the opener. */
  private readonly opener_ends = new Set<number>()
  /** How many cards' first clozes have closed: the order orders the cards sharing a position, innermost first. */
  private closed = 0

  /**
   * @param src - markdown-it's source, which offsets index.
   * @param Token - markdown-it's token class, for the cloze tokens.
   */
  constructor(private readonly src: string, private readonly Token: StateCore['Token']) {
    for (let at = src.indexOf('\n'); at >= 0; at = src.indexOf('\n', at + 1)) this.lines.push(at + 1)
  }

  /**
   * Walk the document's block tokens (see the module comment).
   * @returns The new block token list.
   */
  blocks(tokens: PositionedToken[]): Token[] {
    /* Each token enters and exits, an inline token around its children; document-level clozes may remain at the end. */
    const out: Token[] = []
    /** The kind of the block entered last, which holds an inline token following it. */
    let container = ''
    for (const token of tokens) {
      if (token.type === 'inline') {
        out.push(token)
        token.children = this.text(token, container)
        continue
      }
      if (token.nesting !== -1) {
        container = block_type(token)
        this.enter(token, out)
      }
      if (token.nesting !== 1) this.exit(token, out)
    }
    // Only document-level explicit clozes can remain once every block has exited.
    const end = tokens[tokens.length - 1]?.srmd_span?.end ?? 0
    while (this.open.length) this.close(end)
    return out
  }

  /** The one-based line of an offset. */
  private line(offset: number): number {
    return count_below(this.lines, offset + 1)
  }

  /** The point at an offset. */
  private point(offset: number): Point {
    return { line: this.line(offset), offset }
  }

  /** The range of a span. */
  private range(span: Span): SourceRange {
    return { start: this.point(span.start), end: this.point(span.end) }
  }

  /** A block token entering. */
  private enter(token: PositionedToken, out: Token[]): void {
    /*
     * 1. A block entering where a pending opener waits is its answer: a block cloze opens around it.
     * 2. A reference line takes the position of the block above it; the block's frame opens.
     * 3. List the token, record a definition, and note what later tokens depend on.
     */
    const type = block_type(token)
    const span = token.srmd_span ?? { start: 0, end: 0 }
    const outer = this.depth++
    if (!metadata.has(type)) {
      if (this.pending?.parent_depth === this.block_depth) {
        // A continuation whose group was reopened meanwhile has nothing left to answer.
        if (!this.pending.group.open) {
          this.pending.depth = outer
          this.open_cloze(this.pending, 'block', span.start, out)
        }
        this.pending = undefined
      }
      this.block_depth++
    }

    // Step 2: a reference line follows the block above it, one blank line at most.
    if (!inner_blocks.has(type)) {
      const parent = this.frames[this.frames.length - 1]
      if (type === 'srmd_reference_line') {
        const key = parent.last && this.line(span.start) - parent.last_line <= 2 ? `l${parent.last.start}` : undefined
        const references = (token.meta as LineReference[]).map((reference): CardReference => ({
          ...this.range(reference), ref: reference.ref, key
        }))
        token.meta = references
        this.records.references.push(...references)
      }
      this.frames.push({ last_line: 0 })
    }

    // Step 3: the token.
    if (type === 'paragraph') {
      this.paragraph_at = out.length
      this.visible = false
    }
    out.push(token)
    if (type === 'srmd_definition') {
      const definition: CardDefinition = { ...this.range(span), scheduling: token.meta, root: this.container_depth === 0 }
      token.meta = definition
      this.records.definitions.push(definition)
    } else if (type === 'heading') this.heading = true
    else if (containers.has(type)) this.container_depth++
  }

  /** A block token exiting. */
  private exit(token: PositionedToken, out: Token[]): void {
    /*
     * 1. Clozes opened inside the block close: an answer cannot outlive it.
     * 2. List the closing token, or leave out the paragraph it closes when that renders nothing; the block becomes the
     *    last one of its parent, unless it is metadata or such a paragraph.
     * 3. A pending opener inside the block can no longer get an answer; clozes ready at the new depth close.
     */
    const type = block_type(token)
    const span = token.srmd_span ?? { start: 0, end: 0 }
    const inner = this.depth--
    while (this.open.length && this.open[this.open.length - 1].depth >= inner) this.close(span.end)

    // Step 2: the token, and the block in its parent's frame.
    const hidden = type === 'paragraph' && !this.visible
    if (hidden) out.length = this.paragraph_at
    else if (token.nesting === -1) out.push(token)
    if (type === 'heading') this.heading = false
    else if (containers.has(type)) this.container_depth--
    if (!inner_blocks.has(type)) {
      this.frames.pop()
      const parent = this.frames[this.frames.length - 1]
      if (!metadata.has(type) && !hidden) {
        parent.last = { start: span.start, end: span.end, type, text_end: type === 'paragraph' ? this.text_end : undefined }
      }
      parent.last_line = this.line(span.end)
    }

    // Step 3: pending openers and ready clozes. A table cell bounds its own openers' answers.
    if (!metadata.has(type)) {
      this.block_depth--
      const limit = table_cells.has(type) ? this.block_depth : this.block_depth + 1
      if (this.pending && this.pending.parent_depth >= limit) this.pending = undefined
    }
    this.close_ready(this.depth, span.end)
  }

  /**
   * Walk a text, the children of an inline token, where it stands.
   * @param container - The kind of block holding the text: a paragraph's or a table cell's opener can end it.
   * @returns The new children.
   */
  private text(inline: PositionedToken, container: string): Token[] {
    /*
     * 1. Walk the children; each enters and exits as block tokens do, one level deeper. Collect what placing
     *    references needs: hard breaks, references, closing markers' ends and the inline clozes opened.
     * 2. At the text's end, the clozes still open in it close, and an explicit one clipped by its element's end takes
     *    no closing marker anymore. Then place the text's references and inline clozes.
     */
    const children = (inline.children ?? []) as PositionedToken[]
    const out: Token[] = []
    const text: Text = { inline, breaks: [], references: [], closer_ends: new Set(), clozes: [] }
    const level = ++this.depth
    for (let i = 0; i < children.length; i++) {
      const child = children[i]
      if (child.nesting !== -1) this.enter_child(child, text, out)
      if (child.nesting !== 1) this.exit_child(child, i, children, container, text, out)
    }

    // Step 2: the text's end.
    while (this.open.length && this.open[this.open.length - 1].depth >= level) this.close()
    this.clipped = []
    this.depth--
    this.place_text(text)
    return out
  }

  /** A child token entering: a hard break closes implicit inline clozes; a reference is recorded. */
  private enter_child(child: PositionedToken, text: Text, out: Token[]): void {
    /* A hard break ends the implicit inline clozes before it, which close once nesting allows, before the break. */
    const outer = this.depth++
    if (child.type === 'hardbreak') {
      text.breaks.push(this.span_of(text.inline, child).start)
      for (const entry of this.open) {
        if (!entry.explicit && entry.record!.kind === 'inline') entry.closing = true
      }
      this.close_ready(outer)
    }
    out.push(child)
    if (child.type === 'srmd_reference') {
      if (this.heading) to_text(child)
      else {
        const reference: CardReference = { ...this.range(this.span_of(text.inline, child)), ref: child.meta }
        child.meta = reference
        this.records.references.push(reference)
        text.references.push(reference)
      }
    } else if (child.type !== 'srmd_opener' && child.type !== 'srmd_closer' && is_content(child)) this.visible = true
  }

  /** A child token exiting: an inline element's end, an opener or a closing marker. */
  private exit_child(child: PositionedToken, index: number, children: Token[], container: string, text: Text, out: Token[]): void {
    /*
     * The clozes opened inside a closing element close with it; an explicit one awaiting its closing marker is
     * clipped. Then markers act, and clozes ready at the new depth close.
     */
    const inner = this.depth--
    if (child.nesting === -1) {
      while (this.open.length && this.open[this.open.length - 1].depth >= inner) {
        const entry = this.open[this.open.length - 1]
        this.close()
        if (entry.explicit && !entry.closing) this.clipped.push(entry)
      }
      out.push(child)
    }
    if (child.type === 'srmd_opener') this.opener(child, index, children, container, text, out)
    else if (child.type === 'srmd_closer') this.closer(child, text)
    this.close_ready(this.depth)
  }

  /**
   * An opener exiting: in a heading, or continuing no group or its own open group, it is text. Otherwise it opens an
   * inline cloze after it, or, ending its paragraph's or cell's text, it waits for the next block in its container.
   */
  private opener(child: PositionedToken, index: number, children: Token[], container: string, text: Text, out: Token[]): void {
    /* Find its group, then open, wait or turn into text; an implicit opener shows a colon, an explicit one nothing. */
    const marker = child.meta as MarkerMeta
    const group = this.heading ? undefined : marker.continuation ? this.groups_by_level[marker.level] : { open: false }
    if (!this.heading && !marker.continuation) this.groups_by_level[marker.level] = group
    if (!group || group.open) to_text(child)
    else {
      const span = this.span_of(text.inline, child)
      const block = texts.has(container) && ends_text(children, index)
      const entry: OpenCloze = { group, explicit: marker.explicit, parent_depth: this.block_depth - 1, depth: this.depth, closing: false }
      // The colon is followed by the spaces the opener took when an inline answer follows them on its line.
      const next = children[index + 1]
      const answer_follows = !block && next !== undefined && next.type !== 'softbreak'
      marker.value = marker.explicit ? '' : answer_follows ? ':' + /[ \t]*$/.exec(child.markup)![0] : ':'
      if (block) this.pending = entry
      else {
        this.open_cloze(entry, 'inline', span.end, out)
        text.clozes.push(entry)
      }
      this.records.markers.push(this.range(span))
      if (!marker.explicit) this.opener_ends.add(span.start + child.markup.trimEnd().length)
    }
    if (child.type === 'text' || marker.value) this.visible = true
  }

  /**
   * A closing marker exiting: it ends the latest explicit cloze still awaiting one, open or clipped; one waiting for
   * Markdown takes no other. One ending nothing, or in a heading, is text.
   */
  private closer(child: PositionedToken, text: Text): void {
    /* Find the open and the clipped candidate; the later opened of the two takes the marker. */
    let entry: OpenCloze | undefined
    for (let c = this.open.length - 1; c >= 0 && !this.heading && !entry; c--) {
      if (this.open[c].explicit && !this.open[c].closing) entry = this.open[c]
    }
    const late = this.clipped.reduce<OpenCloze | undefined>((latest, c) => !latest || c.index! > latest.index! ? c : latest, undefined)
    const span = this.span_of(text.inline, child)
    if (late && (!entry || late.index! > entry.index!)) {
      this.clipped.splice(this.clipped.indexOf(late), 1)
      late.record!.end = this.point(span.end)
      late.record!.closer_end = span.end
    } else if (entry) {
      entry.closing = true
      entry.closer = span.end
    } else {
      to_text(child)
      this.visible = true
      return
    }
    this.records.markers.push(this.range(span))
    text.closer_ends.add(span.end)
  }

  /** Open a cloze in a token list: the card is allocated with its group's first cloze; a block cloze opens a frame. */
  private open_cloze(entry: OpenCloze, kind: Cloze['kind'], start: number, tokens: Token[]): void {
    /* A continuation reuses its group's card; a first cloze creates the group. */
    const group = entry.group.group
    const ordinal = group?.ordinal ?? this.records.groups.length + 1
    const scheduling = group?.scheduling ?? new_card(-ordinal)
    const record: Cloze = { kind, start: this.point(start), end: this.point(start), ordinal, scheduling }
    if (!group) {
      entry.group.group = { ordinal, first_cloze: record, scheduling, nesting: 0 }
      this.records.groups.push(entry.group.group)
    }
    this.records.clozes.push(record)
    const tag = kind === 'block' ? 'div' : 'span'
    const open = new this.Token('srmd_cloze_open', tag, 1)
    open.meta = record
    open.block = kind === 'block'
    entry.close_token = new this.Token('srmd_cloze_close', tag, -1)
    entry.close_token.meta = record
    entry.close_token.block = open.block
    entry.group.open = true
    entry.record = record
    entry.tokens = tokens
    entry.index = this.records.clozes.length - 1
    tokens.push(open)
    this.open.push(entry)
    if (kind === 'block') this.frames.push({ last_line: 0 })
  }

  /**
   * Close the innermost cloze. Its record ends at its closing marker if it had one; else a block cloze's at `at`, the
   * end of what closed it, and an inline cloze's at its piece's content end (place_text()). A block cloze stands for
   * its last block in its parent's frame, where its card's reference belongs unless a closing marker ended it.
   */
  private close(at?: number): void {
    const entry = this.open.pop()!
    const record = entry.record!
    const group = entry.group.group!
    const end = entry.closer ?? at
    if (end !== undefined) record.end = this.point(end)
    if (entry.closer !== undefined) record.closer_end = entry.closer
    entry.group.open = false
    entry.tokens!.push(entry.close_token!)
    if (record === group.first_cloze) group.nesting = ++this.closed
    if (record.kind === 'inline') return
    const frame = this.frames.pop()!
    const parent = this.frames[this.frames.length - 1]
    if (frame.last) parent.last = frame.last
    parent.last_line = this.line(end ?? 0)
    if (record === group.first_cloze) this.place(group, frame.last?.text_end, frame.last)
  }

  /**
   * Close the innermost clozes ready to close at depth: implicit block clozes after their block, closing ones once
   * nesting allows.
   * @param at - Where the token closing them ends, for block clozes.
   */
  private close_ready(depth: number, at?: number): void {
    while (this.open.length) {
      const entry = this.open[this.open.length - 1]
      if (entry.depth !== depth || !(entry.closing || (!entry.explicit && entry.record!.kind === 'block'))) return
      this.close(at)
    }
  }

  /**
   * Place a text's references, and end its inline clozes that have no closing marker syntactically, placing their
   * cards (see the module comment); a text without a source map, as a heading's, has no positions to place.
   */
  private place_text(text: Text): void {
    /*
     * 1. Split the text into pieces at its hard breaks, and step back from each piece's end over whitespace and
     *    references to its content end.
     * 2. Step back from each reference: it is at a position when it follows a closing marker's end or its piece's
     *    content end.
     * 3. An inline cloze without a closing marker ends where the content of its opener's piece does, if that is after
     *    the opener; its card is placed there, a card whose first cloze has one after it.
     */
    const span = text.inline.srmd_span
    if (!text.inline.srmd_map || !span) {
      for (const entry of text.clozes) {
        if (entry.record!.closer_end === undefined) entry.record!.end = entry.record!.start
        if (entry.record === entry.group.group!.first_cloze) this.place(entry.group.group!, undefined)
      }
      this.text_end = undefined
      return
    }
    const starts = [span.start, ...text.breaks.map(at => at + 1)]
    const ends = [...text.breaks, span.end]
    /** Where each reference starts, by where it ends, for stepping back over it. */
    const reference_starts = new Map(text.references.map(reference => [reference.end.offset, reference.start.offset]))
    /** Where the references placed so far follow, by where they start: stepping back over one goes on from there. */
    const follows = new Map<number, number>()
    /** Step back from an offset over whitespace and references, not before floor. */
    const back = (offset: number, floor: number): number => {
      for (;;) {
        while (offset > floor && /\s/.test(this.src[offset - 1])) offset--
        const start = reference_starts.get(offset)
        if (start === undefined || start < floor) return offset
        offset = follows.get(start) ?? start
      }
    }
    const content_ends = ends.map((end, k) => back(end, starts[k]))

    // Step 2: the references' positions. References, as clozes, come in text order, so the piece holding each follows
    // the previous one's.
    let k = 0
    for (const reference of text.references) {
      while (k + 1 < starts.length && starts[k + 1] <= reference.start.offset) k++
      const at = back(reference.start.offset, starts[k])
      follows.set(reference.start.offset, at)
      const placed = text.closer_ends.has(at) || (at === content_ends[k] && at > starts[k])
      reference.key = placed ? `t${at}` : undefined
    }

    // Step 3: the inline clozes' syntactical ends.
    k = 0
    for (const entry of text.clozes) {
      const record = entry.record!
      while (k + 1 < ends.length && ends[k] < record.start.offset) k++
      const content = content_ends[k] > starts[k] && content_ends[k] > record.start.offset ? content_ends[k] : undefined
      if (record.closer_end === undefined) record.end = content === undefined ? record.start : this.point(content)
      if (record === entry.group.group!.first_cloze) this.place(entry.group.group!, content)
    }
    const last = content_ends.length - 1
    this.text_end = content_ends[last] > starts[last] ? content_ends[last] : undefined
  }

  /**
   * Give a card its position and the insertion of a new reference there, from its first cloze (see the module
   * comment): after its closing marker; on a line after its last block when that is no paragraph; else at end, where
   * its text's content ends, if it has content.
   */
  private place(group: Group, end: number | undefined, last?: Block): void {
    const closer_end = group.first_cloze.closer_end
    if (closer_end !== undefined) {
      group.key = `t${closer_end}`
      group.insertion = { kind: 'inline', offset: closer_end, space: false }
    } else if (last && last.type !== 'paragraph') {
      group.key = `l${last.start}`
      group.insertion = line_insertion(this.src, last)
    } else if (end !== undefined) {
      group.key = `t${end}`
      group.insertion = { kind: 'inline', offset: end, space: this.opener_ends.has(end) || needs_space(this.src, end) }
    }
  }

  /** A child's span: from where it was pushed, over its markup; without a source map, its text's span. */
  private span_of(inline: PositionedToken, child: PositionedToken): Span {
    const at = child.srmd_pushed
    if (!inline.srmd_map || at === undefined) return inline.srmd_span ?? { start: 0, end: 0 }
    return span_to_source(inline.srmd_map, { start: at, end: at + child.markup.length })
  }
}

/**
 * Whether a reference written at offset needs a space before it: after `!`, `![` would start an image; after an
 * odd run of backslashes `\[` would be escaped; and after a literal URL, such as `https://example.com/a` or
 * `www.example.com`, the reference would become part of it, also with only punctuation such as `.` between.
 */
function needs_space(source: string, offset: number): boolean {
  /*
   * 1. Check the character before the offset for `!`.
   * 2. A literal URL runs to the next whitespace or `<`: step back to the start of that word, then look for a scheme
   *    or `www.` starting a URL in it.
   * 3. Backslashes escape in pairs; count the run before the offset.
   */
  if (source[offset - 1] === '!') return true
  let word_start = offset
  while (word_start > 0 && !/[\s<]/.test(source[word_start - 1])) word_start--
  if (/(?:^|[*_~(])(?:https?:\/\/|www\.)/i.test(source.slice(word_start, offset))) return true
  let slashes = 0
  while (offset > 0 && source[--offset] === '\\') slashes++
  return slashes % 2 === 1
}

/**
 * Write a reference line after a block, with the line prefix of its containers: the text before the block on its
 * first line, list markers as spaces (`> `, list indentation). Only an HTML block of kind 6 or 7, which takes the
 * next line as content, needs a blank line first; a reference line ends any other block.
 */
function line_insertion(source: string, block: Block): Insertion {
  /* Find the block's first line for the prefix, and its end before trailing spaces. */
  let start = block.start
  while (start > 0 && source[start - 1] !== '\n') start--
  let end = block.end
  while (source[end - 1] === ' ' || source[end - 1] === '\t') end--
  const prefix = source.slice(start, block.start).replace(/[^\t >]/g, ' ')
  const blank = block.type === 'html_block' && !self_ending_html.test(source.slice(block.start))
  return { kind: 'line', offset: end, prefix, blank }
}
