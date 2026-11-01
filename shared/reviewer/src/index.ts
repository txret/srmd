/** Host-independent review preparation. DOM interaction and HTML controls belong to ui. */
import { m } from '../../l10n/src'
import { render, type ParsedNote } from '../../parser/src'
import { Rating, type Interval, type Scheduler, type Note, type NoteProblem, type ReviewRating } from '../../scheduler/src'

export { review_scopes, type ReviewScope } from './scopes'

/** Choice text shared by HTML and native review surfaces. */
export interface ReviewChoice {
  id: string
  label: string
  detail: string
}

/** A note preview and choices; the host supplies resource URLs and presents the result. */
export interface ReviewData {
  path: string
  /** The heading: the note's path relative to the workspace. */
  title: string
  html: string
  /** The reviewed card's ordinal: its clozes in the HTML have this `data-ordinal` value. */
  card_ordinal: number
  choices: ReviewChoice[]
  /** Plain-text lines to show above the note: a heading and the note's problems, or none. */
  notices: string[]
}

/**
 * Build the scheduler note for a parse: its cards and invalid dates, the parse's definition problems,
 * and the parsed text as its version. Insert the result with Scheduler.update().
 */
export function note_from_parse(scheduler: Scheduler, path: string, parsed: ParsedNote, now: Date = new Date()): { note: Note; scheduling_changed: boolean } {
  /* Build the scheduled note, then put the parse's problems before its invalid dates, in source order. */
  const result = scheduler.create_note(path, parsed.scheduling, now)
  result.note.problems.unshift(...parsed.problems)
  result.note.version = parsed.source
  return result
}

/** A note problem as one plain-text sentence, in the language selected with set_language(). */
export function problem_text(problem: NoteProblem): string {
  /* Definitions are quoted as written, `{3}`; message syntax reserves braces, so they arrive as a value. */
  if (problem.kind === 'invalid_date') {
    const field = problem.field === 'due' ? m.reviewer_field_due() : m.reviewer_field_last_review()
    return m.reviewer_problem_invalid_date({ ordinal: problem.ordinal, field, value: problem.value })
  }
  const message = problem.kind === 'unmatched_definition' ? m.reviewer_problem_unmatched_definition : m.reviewer_problem_duplicate_definition
  return message({ line: problem.line, definition: `[:${problem.ref}]` })
}

/**
 * Render a parsed note with current scheduling and preview its available ratings.
 * The caller retains the same parse for serialize() after applying a review.
 * path and ordinal identify a loaded note and a one-based card. Texts use the language selected with set_language().
 */
export function prepare_review(
  scheduler: Scheduler, path: string, ordinal: number, parsed: ParsedNote, now: Date = new Date()
): ReviewData {
  /* Render using live card records, then combine FSRS previews and fixed-interval choices as translated plain text. */
  const note = scheduler.state.nodes[path] as Note
  const future = scheduler.peek(path, ordinal, now)
  /** Format a previewed FSRS interval in days or minutes. */
  const interval = ({ unit, count }: Interval): string => unit === 'days' ? m.reviewer_days({ count }) : m.reviewer_minutes({ count })
  return {
    path,
    title: path || m.reviewer_untitled(),
    html: render(parsed, { scheduling: note.cards }),
    card_ordinal: ordinal,
    choices: [
      { id: 'again', label: m.reviewer_again(), detail: interval(future.again) },
      { id: 'hard', label: m.reviewer_hard(), detail: interval(future.hard) },
      { id: 'good', label: m.reviewer_good(), detail: interval(future.good) },
      { id: 'easy', label: m.reviewer_easy(), detail: interval(future.easy) },
      // Fixed-interval choices match the day ranges Scheduler.review() balances across.
      { id: 'tomorrow', label: m.reviewer_tomorrow(), detail: m.reviewer_days({ count: 1 }) },
      { id: 'soon', label: m.reviewer_soon(), detail: m.reviewer_day_range({ min: 3, max: 5 }) },
      { id: 'later', label: m.reviewer_later(), detail: m.reviewer_day_range({ min: 7, max: 21 }) }
    ],
    notices: note.problems.length ? [m.reviewer_problems_heading(), ...note.problems.map(problem_text)] : []
  }
}

/** Convert a review choice identifier to its FSRS grade or fixed-interval choice; null for an unknown identifier. */
export function review_rating(choice_id: string): ReviewRating | null {
  /* Fixed-interval choices keep their identifiers; anything else is not a choice prepare_review() offered. */
  switch (choice_id) {
    case 'again': return Rating.Again
    case 'hard': return Rating.Hard
    case 'good': return Rating.Good
    case 'easy': return Rating.Easy
    case 'tomorrow':
    case 'soon':
    case 'later': return choice_id
    default: return null
  }
}
