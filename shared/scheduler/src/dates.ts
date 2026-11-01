/** Shared local-calendar helpers for scheduler hints, queues and FSRS conversion. */

/** Milliseconds per UTC day, used only to index local calendar dates. */
export const DAY_MS = 86400000

/** Return the local calendar-day index, moving before-rollover times into the preceding day. */
export function review_day(date: Date, rollover: number): number {
  /* Compare local wall time with rollover, then use UTC arithmetic only for the date index. */
  const boundary = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, rollover)
  const calendar_day = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS
  return calendar_day - (date.getTime() < boundary.getTime() ? 1 : 0)
}

/** Advance review days and return their local rollover time, including across DST changes. */
export function add_review_days(date: Date, days: number, rollover: number): Date {
  /* Advance the calendar index, then reconstruct the destination using local wall-clock time. */
  const day = new Date((review_day(date, rollover) + days) * DAY_MS)
  return new Date(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, 0, 0, rollover)
}

/** Count review days between two instants using the supplied local rollover. */
export const day_diff = (left: Date, right: Date, rollover: number): number => review_day(left, rollover) - review_day(right, rollover)

/** Days of each month in a common year; February has a 29th in leap years. */
const month_days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/**
 * Whether a compact timestamp is unset (`0`) or names a real local date and time.
 * The definition grammar checks only the fourteen-digit shape, so `20260834…` (34 August) or hour 25 reach here.
 */
export function is_valid_date(value: string): boolean {
  /*
   * Check the shape, then each component against its calendar range, with the Gregorian leap years Date counts, back
   * to year 1; no Date is needed, as loading checks every stored date.
   */
  if (value === '0') return true
  if (!/^\d{14}$/.test(value)) return false
  const [year, month, day] = [Number(value.slice(0, 4)), Number(value.slice(4, 6)), Number(value.slice(6, 8))]
  const leap_day = month === 2 && year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 1 : 0
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= month_days[month - 1] + leap_day &&
    Number(value.slice(8, 10)) <= 23 && Number(value.slice(10, 12)) <= 59 && Number(value.slice(12, 14)) <= 59
}

/** Decode a compact local timestamp checked by is_valid_date(); `0` means the date is unset. */
export function parse_date(value: string): Date | undefined {
  /* Handle the unset sentinel, then set local components; setFullYear keeps years below 100 as written. */
  if (value === '0') return undefined
  const date = new Date(0)
  date.setFullYear(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)))
  date.setHours(Number(value.slice(8, 10)), Number(value.slice(10, 12)), Number(value.slice(12, 14)), 0)
  return date
}

/** Encode a local timestamp in the definition format; an unset/epoch date becomes `0`. Invalid dates throw. */
export function serialize_date(date?: Date): string {
  /* Preserve the unset sentinel, reject dates the format cannot hold, then write fixed-width local components. */
  if (!date || date.getTime() === 0) return '0'
  // Silently writing `0` here would turn a scheduled card into one without a due date.
  if (Number.isNaN(date.getTime()) || date.getFullYear() < 1 || date.getFullYear() > 9999) throw new RangeError(`Unrepresentable date: ${date}`)
  return [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((value, index) =>
      /* The year has four digits and all remaining local components have two. */
      String(value).padStart(index === 0 ? 4 : 2, '0')).join('')
}
