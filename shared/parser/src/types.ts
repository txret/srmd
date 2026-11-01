/** Public pipeline records: cards, their metadata in the source, and what a parse and its environment hold. */
import type MarkdownIt from 'markdown-it'
import type { Token } from 'markdown-it'

/** Four persisted states plus temporary hints preserved by the parser and resolved by the scheduler. */
export type CardState = 'n' | 'l' | 'k' | 'r' | '!' | `${number}${'d' | 'w' | 'm'}`

/** Dates retain their compact local representation while parsing. */
export interface Scheduling {
  /** Reference as written, or a note-local negative ref for a card without a matched definition. */
  ref: number
  state: CardState
  /** Local yyyymmddhhmmss, or '0' when no due date is set. */
  due: string
  /** Scheduled interval in days, possibly fractional; elapsed days are not persisted. */
  scheduled_days: number
  /** Same representation as due; '0' means never reviewed. */
  last_review: string
  /** Persisted FSRS memory parameters; zero until initialized. */
  stability: number
  difficulty: number
  /** Current position in learning/relearning steps. */
  learning_steps: number
  /** Total review count and lapse count. */
  reps: number
  lapses: number
}

/** A place in a note's text (see ParsedNote): its one-based line, and the offset into the text. */
export interface Point {
  line: number
  offset: number
}

/** A piece of a note's text, from start to end. */
export interface SourceRange {
  start: Point
  end: Point
}

/**
 * A cloze: an inline cloze, which renders as a span, or a block cloze around blocks, which renders as a div. It runs
 * from where its answer starts to where it ends, at its closing marker if it has one.
 */
export interface Cloze extends SourceRange {
  kind: 'inline' | 'block'
  /** Card ordinal: the position of the cloze's group among the note's cards, from 1. */
  ordinal: number
  /** The card's scheduling, shared by every cloze of the group. */
  scheduling: Scheduling
  /** Offset after the closing marker (`<::`) that closed an explicit cloze, if one did. */
  closer_end?: number
}

/**
 * Where serialize() writes a reference at a card's position when none stands there (see clozes.ts):
 * - inline: at offset, the end of a text, after a space when the text would otherwise swallow the reference;
 * - line: on a new line after offset, the end of a block, with the line prefix of the block's containers (such
 *   as `> ` or list indentation), after a blank line when Markdown needs one to end the block.
 */
export type Insertion =
  | { kind: 'inline'; offset: number; space: boolean }
  | { kind: 'line'; offset: number; prefix: string; blank: boolean }

/** A card as parsing found it, from its group's first cloze. Allocated with that cloze, matched after resolution. */
export interface Group {
  ordinal: number
  first_cloze: Cloze
  scheduling: Scheduling
  /** The position where this card's reference belongs (see clozes.ts); absent when the cloze has no content. */
  key?: string
  /** Where a new reference goes at key. */
  insertion?: Insertion
  /** Order among cards sharing a position, innermost first: when the first cloze ended among the note's clozes. */
  nesting: number
  /** The reference standing at key that this card owns. */
  reference?: CardReference
  /** The first definition with the owned reference's identifier, unless an earlier card claimed it. */
  definition?: CardDefinition
}

/** A card reference `[:n]` where srmd syntax is recognized. Every one is metadata, owned or misplaced. */
export interface CardReference extends SourceRange {
  ref: number
  /** The position it stands at (see clozes.ts); undefined where no card's reference can stand. */
  key?: string
}

/** A card definition with its validated fields. */
export interface CardDefinition extends SourceRange {
  scheduling: Scheduling
  /** Outside lists and quotes: only root-level definitions form the block where new definitions go. */
  root: boolean
}

/** A card's definition whose state is a manual hint; persist_hints() writes the resolved state and due date there. */
export interface Hint {
  ordinal: number
  definition: CardDefinition
}

/**
 * A definition that no card uses, or a repeat of an earlier definition's identifier. serialize() removes both,
 * so a definition whose reference was edited away loses its scheduling on the next save; hosts warn about these.
 * line is the definition's one-based source line.
 */
export interface DefinitionProblem {
  kind: 'unmatched_definition' | 'duplicate_definition'
  ref: number
  line: number
}

/** The cards of a note and their metadata as parsing records them, before references and definitions are matched. */
export interface CardParserState {
  groups: Group[]
  /** Card references in source order, excluding literal `[:n]` in headings, code and HTML. */
  references: CardReference[]
  definitions: CardDefinition[]
}

/** The cards of a note, matched with their references and definitions. */
export interface Cards extends CardParserState {
  /** Always in card ordinal order; refs need not equal index + 1. */
  scheduling: Scheduling[]
  /** The cards' definitions holding manual hints, in ordinal order; a host saves them with persist_hints(). */
  hints: Hint[]
  /** Definitions a save would remove, in source order. */
  problems: DefinitionProblem[]
  /** Every cloze, in the order the clozes start, an enclosing cloze before those inside it. */
  clozes: Cloze[]
  /** The cloze markers that open or close a cloze, in source order; markers that do neither are text. */
  markers: SourceRange[]
}

/**
 * What srmd keeps in a parse's environment, as `env.srmd`, from parsing to rendering; srmd syntax applies to a parse
 * whose environment carries it.
 */
export interface SrmdEnv {
  /** A note shown inside another, as an embed: its clozes render with ordinal 0 and no scheduling. */
  embedded?: boolean
  /** Replacement cards for rendering, one per card in ordinal order. */
  scheduling?: readonly Scheduling[]
  /** What the cloze rule found. */
  cards?: Cards
}

/**
 * A parsed note: the untouched source and the text parsed, markdown-it's tokens with srmd's, the environment rendering
 * reuses, and the cards with the metadata records serialize() and persist_hints() edit at their offsets.
 */
export interface ParsedNote extends Cards {
  /** The note as given. */
  source: string
  /**
   * The note as parsed, which the records' offsets index: the source without a byte order mark, its line endings `\n`.
   * serialize() and persist_hints() edit it and give the result the source's line endings and byte order mark.
   */
  text: string
  /** The instance the note was parsed with, which render() uses too. */
  md: MarkdownIt
  /** markdown-it's block tokens, with srmd's cloze tokens and inline children. */
  tokens: Token[]
  /** The parse's environment, which plugins such as footnotes carry from parsing to rendering. */
  env: { srmd: SrmdEnv }
}
