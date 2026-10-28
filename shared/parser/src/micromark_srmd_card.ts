/**
 * Micromark constructs for srmd card metadata (SYNTAX.md, "Card references" and "Card definitions"):
 * - a card reference, `[:1]`: a colon and a positive integer in brackets, in text;
 * - a reference line: a line holding only references, `[:1]` or `[:2][:1]`, a block construct;
 * - a card definition: `[:1]: k 20261012040000 7 20261005120000 8.5 4.2 0 10 1`, one card's scheduling on one line.
 *
 * Tokenizers are state machines: consume() advances input, returning a state continues there, ok accepts the
 * construct, and nok lets micromark roll the attempt back to ordinary Markdown. Which card a reference belongs
 * to is decided after parsing (positions.ts and cards.ts); every recognized reference is metadata.
 */
import { factorySpace as factory_space } from 'micromark-factory-space'
import { asciiDigit as is_digit, markdownLineEnding as is_eol, markdownSpace as is_space } from 'micromark-util-character'
import type { Code, CompileContext, Construct, Effects, Extension, HtmlExtension, State, TokenizeContext } from 'micromark-util-types'
import type { CardDefinition, CardReference, Scheduling } from './types'

/** Whether digits spell a positive integer that JavaScript represents exactly. */
function is_identifier(digits: string): boolean {
  const value = Number(digits)
  return digits !== '' && Number.isSafeInteger(value) && value > 0
}

/** A card reference, attempted in text and within reference lines. */
const reference: Construct = { name: 'cardReference', tokenize: tokenize_reference }

/**
 * Tokenize a card reference positioned at `[`.
 * @param effects - Micromark's speculative token operations.
 * @param ok - Continue after the closing bracket.
 * @param nok - Leave the bracket to ordinary Markdown, such as a link or a footnote call. At the start of a line
 *   or block, `[:1]:` is the label of a definition that failed validation; it stays text, so saving preserves it.
 * @returns The initial tokenizer state.
 */
function tokenize_reference(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  /*
   * 1. Consume `[` and the colon.
   * 2. Accumulate digits until `]`, then store the identifier on the token and accept, unless a colon follows
   *    a reference that starts its line or block.
   */
  /** Whether the bracket starts a line or a block's text (previous is null at the start of a text). */
  const line_start = this.previous === null || is_eol(this.previous)
  /** The identifier read so far. */
  let digits = ''
  let token: CardReference
  return start

  /** Open the reference at `[`. */
  function start(code: Code): State | undefined {
    token = effects.enter('cardReference') as CardReference
    effects.consume(code)
    return colon
  }

  /** Require the colon that distinguishes a reference from a link label. */
  function colon(code: Code): State | undefined {
    if (code !== 58 /*:*/) return nok(code)
    effects.consume(code)
    return identifier
  }

  /** Read digits up to the closing bracket. */
  function identifier(code: Code): State | undefined {
    if (is_digit(code)) {
      digits += String.fromCharCode(code!)
      effects.consume(code)
      return identifier
    }
    if (code !== 93 /*]*/ || !is_identifier(digits)) return nok(code)
    effects.consume(code)
    token.ref = Number(digits)
    effects.exit('cardReference')
    return line_start ? label_check : ok
  }

  /** Reject a definition label: a colon right after a reference at the start of a line or block. */
  function label_check(code: Code): State | undefined {
    return code === 58 /*:*/ ? nok(code) : ok(code)
  }
}

/**
 * Tokenize a reference line positioned at its first `[`: one or more references, separated by spaces or tabs
 * and nothing else, up to the line ending. It is a flow construct, like a thematic break: it interrupts a
 * paragraph, so on a lazy line after a list, quote or table it ends them rather than continuing their text.
 * @param effects - Micromark's speculative token operations.
 * @param ok - Continue at the line ending or end of input.
 * @param nok - Leave the line to the next construct, such as a definition or a paragraph.
 * @returns The initial tokenizer state.
 */
function tokenize_reference_line(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  return start

  /** Open the line. */
  function start(code: Code): State | undefined {
    effects.enter('cardReferenceLine')
    return next(code)
  }

  /** Read a reference. */
  function next(code: Code): State | undefined {
    if (code !== 91 /*[*/) return nok(code)
    return effects.attempt(reference, after, nok)(code)
  }

  /** Allow spaces or tabs after a reference, then another reference or the end of the line. */
  function after(code: Code): State | undefined {
    if (is_space(code)) return factory_space(effects, end, 'whitespace')(code)
    return end(code)
  }

  /** Close the line at its end; anything but a reference makes it ordinary content. */
  function end(code: Code): State | undefined {
    if (code === null || is_eol(code)) {
      effects.exit('cardReferenceLine')
      return ok(code)
    }
    return next(code)
  }
}

/** Field syntaxes: a date is `0` or fourteen digits, a decimal may be an integer, a count is an integer. */
const date = /^(?:0|\d{14})$/
const decimal = /^(?:\d+(?:\.\d+)?|\.\d+)$/
const count = /^\d+$/
/** Patterns of the nine scheduling fields after the label, in order. Hints are day, week or month counts. */
const field_patterns = [/^(?:[nlkr!]|\d+[dwm])$/, date, decimal, date, decimal, decimal, count, count, count]

/**
 * Read a definition line at the Markdown input boundary.
 * @param line - The line from its `[` to its end, without the line ending.
 * @returns Scheduling with absent fields zero, or null to leave an invalid definition as text.
 */
function read_definition(line: string): Scheduling | null {
  /*
   * 1. Split the label from one to nine fields separated by spaces or tabs, and match each field's pattern;
   *    integers are valid decimals.
   * 2. Convert the fields, absent ones zero as SYNTAX.md defines, then require a hint's count to be positive and
   *    every number to be exactly representable.
   */
  const match = /^\[:(\d+)\]:[ \t]*(.*?)[ \t]*$/.exec(line)
  if (!match || !is_identifier(match[1])) return null
  const fields = match[2] ? match[2].split(/[ \t]+/) : []
  if (!fields.length || fields.length > 9 || fields.some((field, index) => !field_patterns[index].test(field))) return null
  const [state, due = '0', scheduled_days = '0', last_review = '0', stability = '0', difficulty = '0',
    learning_steps = '0', reps = '0', lapses = '0'] = fields
  if (/^\d+[dwm]$/.test(state) && !(Number(state.slice(0, -1)) > 0)) return null
  const card: Scheduling = {
    ref: Number(match[1]), state: state as Scheduling['state'], due,
    scheduled_days: Number(scheduled_days), last_review,
    stability: Number(stability), difficulty: Number(difficulty),
    learning_steps: Number(learning_steps), reps: Number(reps), lapses: Number(lapses)
  }
  const representable = Number.isSafeInteger(card.learning_steps) && Number.isSafeInteger(card.reps) &&
    Number.isSafeInteger(card.lapses) && Number.isFinite(card.scheduled_days) && Number.isFinite(card.stability) &&
    Number.isFinite(card.difficulty)
  return representable ? card : null
}

/**
 * Tokenize a card definition positioned at `[`: the whole line, validated by read_definition() at its end. A
 * definition starts content like a link definition, so it cannot interrupt a paragraph, and it is tried before
 * link definitions, which `[:1]: k` would otherwise also satisfy.
 * @param effects - Micromark's speculative token operations.
 * @param ok - Continue at the line ending or end of input.
 * @param nok - Leave the line to other constructs; an invalid definition is ordinary text.
 * @returns The initial tokenizer state.
 */
function tokenize_definition(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  /** The line read so far. Micromark spells a tab as -2 followed by virtual spaces (-1) up to its tab stop. */
  let line = '['
  let token: CardDefinition
  return start

  /** Open the definition at `[`. */
  function start(code: Code): State | undefined {
    token = effects.enter('cardDefinition') as CardDefinition
    effects.consume(code)
    return label
  }

  /**
   * Require the colon of the label right after `[`. A line starting with anything else, such as a link or a wiki link,
   * is left to other constructs at once rather than read to its end.
   */
  function label(code: Code): State | undefined {
    return code === 58 /*:*/ ? read(code) : nok(code)
  }

  /** Read up to the line ending, then validate the line. */
  function read(code: Code): State | undefined {
    if (code === null || is_eol(code)) {
      const scheduling = read_definition(line)
      if (!scheduling) return nok(code)
      token.scheduling = scheduling
      effects.exit('cardDefinition')
      return ok(code)
    }
    if (code !== -1) line += code === -2 ? '\t' : String.fromCharCode(code)
    effects.consume(code)
    return read
  }
}

/**
 * Register reference lines in flow, definitions where Markdown content starts, before link definitions, and
 * references in text. Code, HTML and escapes (`\[:1]`) keep their Markdown meaning.
 * @returns The syntax extension.
 */
export function card_syntax(): Extension {
  return {
    flow: { 91: { name: 'cardReferenceLine', tokenize: tokenize_reference_line } },
    contentInitial: { 91: { name: 'cardDefinition', tokenize: tokenize_definition } },
    text: { 91: reference }
  }
}

/**
 * Hide card metadata: references, reference lines and definitions produce no HTML; they supply data for the
 * cloze elements only. Buffering a whole line also hides the whitespace tokens inside it.
 * @returns The HTML extension.
 */
export function card_html(): HtmlExtension {
  /** Start buffering a metadata line's output. */
  function buffer(this: CompileContext): undefined {
    this.buffer()
  }
  /** Drop the buffered output. */
  function discard(this: CompileContext): undefined {
    this.resume()
  }
  /** Drop a reference line's output and, like a block that renders nothing, the line ending after it. */
  function discard_line(this: CompileContext): undefined {
    this.resume()
    this.setData('slurpOneLineEnding', true)
  }
  return {
    enter: { cardDefinition: buffer, cardReferenceLine: buffer },
    exit: { cardDefinition: discard, cardReferenceLine: discard_line, cardReference() {} }
  }
}
