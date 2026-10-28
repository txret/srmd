/** Public pipeline records and the additional micromark token names. */
import type { Event, Extension, HtmlExtension, Token } from 'micromark-util-types'

/** An optional micromark extension: its syntax for parse() and its HTML for render(). */
export interface MarkdownExtension {
  syntax: Extension
  html: HtmlExtension
}

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

/** Token enclosing a cloze's answer events: an inline cloze renders as a span, a block cloze as a div. */
export interface ClozeToken extends Token {
  /** Card ordinal: the position of the cloze's group among the note's cards, from 1. */
  _ordinal: number
  /** The card's scheduling, shared by every cloze of the group. */
  _scheduling: Scheduling
  /** Source offset after the closing marker (`<::`) that closed an explicit cloze, if one did. */
  _closer_end?: number
}

/**
 * Where serialize() writes a reference at a card's position when none stands there (see positions.ts):
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
  first_cloze: ClozeToken
  scheduling: Scheduling
  /** The position where this card's reference belongs (see positions.ts); absent when the cloze has no content. */
  key?: string
  /** Where a new reference goes at key. */
  insertion?: Insertion
  /** Order among cards sharing a position, innermost first: the index of the first cloze's exit event. */
  nesting: number
  /** The reference standing at key that this card owns. */
  reference?: CardReference
  /** The first definition with the owned reference's identifier, unless an earlier card claimed it. */
  definition?: CardDefinition
}

/** A card reference `[:n]` in text where srmd syntax is recognized. Every one is metadata, owned or misplaced. */
export interface CardReference extends Token {
  ref: number
  /** The position it stands at (see positions.ts); undefined where no card's reference can stand. */
  key?: string
  /** The reference line holding it, when references fill their line. */
  line?: Token
}

/** A card definition with its validated fields. */
export interface CardDefinition extends Token {
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

/** Per-document state populated by the extensions while resolving Markdown. */
export interface CardParserState {
  source: string
  groups: Group[]
  /** Card references in source order, excluding literal `[:n]` in headings, code and HTML. */
  references: CardReference[]
  definitions: CardDefinition[]
}

/**
 * Untouched source, its live events, one usable scheduling record per card, and the matched
 * metadata records that serialize() and persist_hints() edit at their original source offsets.
 */
export interface ParsedNote {
  source: string
  /** Live [enter|exit, token, tokenizer-context] tuples, required by render(). */
  events: Event[]
  /** The optional extensions the note was parsed with, which render() needs too. */
  extensions: readonly MarkdownExtension[]
  /** Always in card ordinal order; refs need not equal index + 1. */
  scheduling: Scheduling[]
  /** Cards in ordinal order, with their positions and matched references and definitions. */
  groups: Group[]
  /** Every card reference in source order, owned or misplaced. */
  references: CardReference[]
  /** Every recognized definition in source order, matched or not. */
  definitions: CardDefinition[]
  /** The cards' definitions holding manual hints, in ordinal order; a host saves them with persist_hints(). */
  hints: Hint[]
  /** Definitions a save would remove, in source order. */
  problems: DefinitionProblem[]
}

// Extend micromark's token union instead of weakening token.type to string/any.
declare module 'micromark-util-types' {
  interface ParseContext {
    card_state: CardParserState
  }
  interface TokenTypeMap {
    cardReference: 'cardReference'
    cardReferenceLine: 'cardReferenceLine'
    cardDefinition: 'cardDefinition'
    clozeOpen: 'clozeOpen'
    clozeClose: 'clozeClose'
    inlineCloze: 'inlineCloze'
    blockCloze: 'blockCloze'
    clozeEmptyParagraph: 'clozeEmptyParagraph'
  }
}
