/**
 * srmd card records: allocation, the canonical definition text, and matching references and definitions to cards
 * (SYNTAX.md, "Card references" and "Card definitions").
 */
import type { CardDefinition, CardParserState, DefinitionProblem, Group, Hint, Scheduling } from './types'

/**
 * Group cards by the position where their reference belongs (see positions.ts), innermost first at each.
 * @returns Cards by key; a position holds several cards where first clozes share an ending.
 */
export function cards_by_key(groups: readonly Group[]): Map<string, Group[]> {
  const cards_at = new Map<string, Group[]>()
  for (const group of groups) {
    if (group.key) cards_at.set(group.key, [...cards_at.get(group.key) ?? [], group])
  }
  for (const cards of cards_at.values()) cards.sort((left, right) => left.nesting - right.nesting)
  return cards_at
}

/**
 * Match card references to cards by position, then definitions to cards by identifier.
 * @param state - Completed parser records whose references and cards have positions (see positions.ts).
 * @returns One scheduling record per card in ordinal order, the cards' hint definitions, and the definitions a
 *   save would remove.
 */
export function match_cards(state: CardParserState): { scheduling: Scheduling[]; hints: Hint[]; problems: DefinitionProblem[] } {
  /*
   * 1. Give the references at each position, in reading order, to the cards there, innermost first. Ownership is
   *    settled before any definition is looked at, so a missing definition never moves a reference.
   * 2. The first definition of each identifier counts; later ones are duplicates. Each card, in ordinal order,
   *    copies the definition of its reference's identifier unless an earlier card claimed it.
   * 3. Definitions no card claimed, and duplicates, are problems: a save removes them.
   */
  const cards_at = cards_by_key(state.groups)
  for (const reference of state.references) {
    const card = reference.key ? cards_at.get(reference.key)?.find(card => !card.reference) : undefined
    if (card) card.reference = reference
  }

  // Step 2: definitions by identifier.
  const available = new Map<number, CardDefinition>()
  const problems: DefinitionProblem[] = []
  for (const definition of state.definitions) {
    const ref = definition.scheduling.ref
    if (!available.has(ref)) available.set(ref, definition)
    else problems.push({ kind: 'duplicate_definition', ref, line: definition.start.line })
  }
  const hints: Hint[] = []
  for (const group of state.groups) {
    const definition = group.reference && available.get(group.reference.ref)
    if (!definition) continue
    group.definition = definition
    Object.assign(group.scheduling, definition.scheduling)
    available.delete(definition.scheduling.ref)
    if (is_hint(definition.scheduling.state)) hints.push({ ordinal: group.ordinal, definition })
  }

  // Step 3: definitions still available were claimed by no card.
  for (const definition of available.values()) {
    problems.push({ kind: 'unmatched_definition', ref: definition.scheduling.ref, line: definition.start.line })
  }
  problems.sort((left, right) => left.line - right.line)
  return { scheduling: state.groups.map(group => group.scheduling), hints, problems }
}

/**
 * Allocate unscheduled data when a card's first cloze opens.
 * @param ref - Unique negative reference within the note (`-ordinal`), until a definition supplies one.
 * @returns A mutable card shared by every cloze of the card.
 */
export function new_card(ref: number): Scheduling {
  return {
    ref, state: 'n', due: '0', scheduled_days: 0, last_review: '0',
    stability: 0, difficulty: 0, learning_steps: 0, reps: 0, lapses: 0
  }
}

/** Whether a card has scheduling data to persist: anything but state `n` with every other field zero. */
export function has_scheduling(card: Scheduling): boolean {
  return card.state !== 'n' || card.due !== '0' || card.last_review !== '0' || card.scheduled_days !== 0 ||
    card.stability !== 0 || card.difficulty !== 0 || card.learning_steps !== 0 || card.reps !== 0 || card.lapses !== 0
}

/** Whether digits spell a positive integer that JavaScript represents exactly: a card reference's identifier. */
export function is_identifier(digits: string): boolean {
  const value = Number(digits)
  return digits !== '' && Number.isSafeInteger(value) && value > 0
}

/** Field syntaxes: a date is `0` or fourteen digits, a decimal may be an integer, a count is an integer. */
const date_field = /^(?:0|\d{14})$/
const decimal_field = /^(?:\d+(?:\.\d+)?|\.\d+)$/
const count_field = /^\d+$/
/** Patterns of the nine scheduling fields after the label, in order. Hints are day, week or month counts. */
const field_patterns = [
  /^(?:[nlkr!]|\d+[dwm])$/, date_field, decimal_field, date_field, decimal_field, decimal_field, count_field,
  count_field, count_field
]

/**
 * Read a definition line at the Markdown input boundary (SYNTAX.md, "Card definitions").
 * @param line - The line from its `[` to its end, without the line ending.
 * @returns Scheduling with absent fields zero, or null to leave an invalid definition as text.
 */
export function read_definition(line: string): Scheduling | null {
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

/** Whether a state is a manual scheduling hint (`7d`, `2w`, `1m`, `!`), which the scheduler resolves. */
export function is_hint(state: Scheduling['state']): boolean {
  return state === '!' || /^\d+[dwm]$/.test(state)
}

/**
 * Spell a finite number in plain decimal notation, as the definition grammar requires.
 * JavaScript writes numbers below 1e-6 or from 1e21 with an exponent (`1e-7`); this shifts the decimal
 * point of that same shortest spelling instead, so the value reads back unchanged.
 */
function decimal(value: number): string {
  /* Keep ordinary spellings; otherwise rebuild the digits around the point the exponent selects. */
  const text = String(value)
  const exponential = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(text)
  if (!exponential) return text
  const [, sign, lead, rest = '', exponent] = exponential
  const digits = lead + rest
  // Position of the decimal point within digits.
  const point = 1 + Number(exponent)
  if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`
  if (point >= digits.length) return sign + digits.padEnd(point, '0')
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`
}

/**
 * Format one canonical definition with all ten fields, without normalizing its reference.
 * @param card - Valid scheduling fields in the definition grammar; no escaping or sanitation is performed.
 *   Negative in-memory references, used in rendered attributes, are also supported.
 * @returns One attribute-safe line with no surrounding whitespace or line endings.
 */
export function serialize_card(card: Scheduling): string {
  return `[:${card.ref}]: ${card.state} ${card.due} ${decimal(card.scheduled_days)} ${card.last_review} ` +
    `${decimal(card.stability)} ${decimal(card.difficulty)} ${card.learning_steps} ${card.reps} ${card.lapses}`
}
