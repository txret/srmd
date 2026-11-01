import { SchedulerConfig } from '../../scheduler/src'

/** The settings of a workspace that every host has: which files are notes, and how they are scheduled and shown. */
export interface WorkspaceSettings {
  /** Filename suffixes of spaced-repetition notes. */
  suffixes: string[]
  scheduler: SchedulerConfig
  /** Whether inactive clozes remain visible on each face of a card. */
  inactive: { front: boolean; back: boolean }
}

/** Every queue exactly once; any other order would leave a queue unserved. */
const queues: SchedulerConfig['queue_order'] = ['intraday', 'interday', 'new']

/** A rollover time of day, `hh:mm` or `hh:mm:ss`, from 00:00 to 23:59:59. */
const time_of_day = /^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/

/**
 * Read the shared settings from their stored values, named as VS Code names them without its `srmd.` prefix:
 * `queueOrder`, `rollover`, `suffixes`, `inactive.front` and `inactive.back`. A value outside its schema is reported
 * to invalid by name, in that order, and replaced by its default; a missing value (undefined) takes its default
 * silently.
 * @param get - The stored value of a setting, or undefined.
 */
export function read_settings(get: (name: string) => unknown, invalid: (name: string) => void): WorkspaceSettings {
  /* Validate each value in turn, converting it to its scheduler form. */
  const scheduler = new SchedulerConfig()

  const queue_order = get('queueOrder')
  if (Array.isArray(queue_order) && queue_order.length === queues.length && queues.every(queue => queue_order.includes(queue))) {
    scheduler.queue_order = queue_order
  } else if (queue_order !== undefined) invalid('queueOrder')

  const rollover = get('rollover')
  const time = typeof rollover === 'string' ? rollover.trim().match(time_of_day) : null
  if (time) scheduler.rollover = (Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3] ?? 0)) * 1000
  else if (rollover !== undefined) invalid('rollover')

  const suffixes = get('suffixes')
  const valid_suffixes = Array.isArray(suffixes) && suffixes.length > 0 && suffixes.every(suffix => typeof suffix === 'string' && suffix)
  if (!valid_suffixes && suffixes !== undefined) invalid('suffixes')

  /** A boolean setting, false when missing or invalid. */
  const flag = (name: string): boolean => {
    const value = get(name)
    if (value !== undefined && typeof value !== 'boolean') invalid(name)
    return value === true
  }

  const inactive = { front: flag('inactive.front'), back: flag('inactive.back') }

  return {
    suffixes: valid_suffixes ? suffixes : ['.sr.md'],
    scheduler,
    inactive
  }
}

