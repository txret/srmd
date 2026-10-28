/** Scheduler settings; syntax, filesystem and display settings belong to their callers. */
export class SchedulerConfig {
  queue_order: ('intraday' | 'interday' | 'new')[] = ['intraday', 'interday', 'new']
  /** Local wall-clock milliseconds after midnight, defaulting to 04:00. */
  rollover = 4 * 3600000
}
