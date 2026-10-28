/** FSRS adaptation, fixed intervals and due-day balancing. Parser records remain the common card representation. */
import { fsrs, Rating, type Card as FSRSCard } from 'ts-fsrs'
import type { Scheduling } from '../../parser/src'
import { add_review_days, day_diff, parse_date, serialize_date } from './dates'

/** Persisted state spellings in FSRS numeric order, used only at the conversion boundary. */
const state_string = ['n', 'l', 'k', 'r'] as const

/** Initial learned parameters used when a fixed-interval choice rates a card without FSRS history. */
const default_review = fsrs().next_state(null, 0, Rating.Good)

/** Decode a resolved scheduling record only at the boundary to FSRS. */
export function to_fsrs(card: Scheduling): FSRSCard {
  /* Convert state and dates; the deprecated elapsed_days field is recomputed by FSRS. */
  return {
    state: state_string.indexOf(card.state as typeof state_string[number]),
    due: parse_date(card.due) ?? new Date(0), last_review: parse_date(card.last_review),
    scheduled_days: card.scheduled_days, stability: card.stability, difficulty: card.difficulty,
    learning_steps: card.learning_steps, reps: card.reps, lapses: card.lapses, elapsed_days: 0
  }
}

/** Copy an FSRS result into the existing record, preserving its ref and runtime ordinal. */
export function apply_fsrs(card: Scheduling, result: FSRSCard): void {
  /* Copy only persisted fields; FSRS date objects never enter shared note state. */
  Object.assign(card, {
    state: state_string[result.state], due: serialize_date(result.due), last_review: serialize_date(result.last_review),
    scheduled_days: result.scheduled_days, stability: result.stability, difficulty: result.difficulty,
    learning_steps: result.learning_steps, reps: result.reps, lapses: result.lapses
  })
}

/** Set the interval of a fixed-interval choice, preserving learned parameters and seeding missing ones. */
export function set_due_in(card: Scheduling, days: number, now: Date, rollover: number): void {
  /* Resolve the calendar interval, record this review and reset learning steps for a known card. */
  card.state = 'k'
  card.due = serialize_date(add_review_days(now, days, rollover))
  card.last_review = serialize_date(now)
  card.scheduled_days = days
  if (card.stability <= 0) card.stability = Math.max(default_review.stability, days || 1)
  if (card.difficulty < 1) card.difficulty = default_review.difficulty
  card.learning_steps = 0
  card.reps = Math.max(card.reps, 1)
}

/** Pick an inclusive least-loaded review day; random must return a value in [0, 1). */
export function pick_due_day(cards: readonly Scheduling[], min: number, max: number, now: Date, rollover: number, random: () => number): number {
  /* Count existing dues by review day, then pick uniformly among the least-loaded days. */
  const counts: number[] = new Array(max - min + 1).fill(0)
  for (const card of cards) {
    if (card.state === 'n' || card.due === '0') continue
    const days = day_diff(parse_date(card.due)!, now, rollover)
    if (days >= min && days <= max) counts[days - min]++
  }
  const lowest = Math.min(...counts)
  const candidates: number[] = []
  for (let index = 0; index < counts.length; index++) {
    if (counts[index] === lowest) candidates.push(min + index)
  }
  return candidates[Math.floor(random() * candidates.length)]
}
