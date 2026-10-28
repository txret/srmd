import { foam_placeholders, foam_placeholders_html } from 'micromark-foam-placeholders'
import { default_format_options, format_choices, min_line_width, type FormatOptions, type MarkdownExtension } from '../../parser/src'
import { SchedulerConfig } from '../../scheduler/src'

/**
 * The settings of a workspace that every host has: which files are notes, and how they are parsed, scheduled, shown
 * and formatted.
 */
export interface WorkspaceSettings {
  /** Filename suffixes of spaced-repetition notes. */
  suffixes: string[]
  scheduler: SchedulerConfig
  /** Whether inactive clozes remain visible on each face of a card. */
  inactive: { front: boolean; back: boolean }
  /** Optional Markdown extensions notes are parsed and rendered with. */
  extensions: MarkdownExtension[]
  /** How formatting writes what Markdown can write in more than one way. */
  format: FormatOptions
}

/**
 * The optional Markdown extensions the `extensions` setting can turn on, by name. A Map, since the names come from the
 * user's settings and a plain object would also match inherited keys such as `constructor`.
 */
const optional_extensions = new Map<string, MarkdownExtension>([
  ['foam-placeholders', { syntax: foam_placeholders(), html: foam_placeholders_html() }]
])

/** Every queue exactly once; any other order would leave a queue unserved. */
const queues: SchedulerConfig['queue_order'] = ['intraday', 'interday', 'new']

/** A rollover time of day, `hh:mm` or `hh:mm:ss`, from 00:00 to 23:59:59. */
const time_of_day = /^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/

/**
 * Read the shared settings from their stored values, named as VS Code names them without its `srmd.` prefix:
 * `queueOrder`, `rollover`, `extensions`, `suffixes`, `inactive.front` and `inactive.back`, then the formatting
 * options, `format.wrap`, `format.lineWidth`, `format.numbering`, `format.bullet`, `format.tableDelimiters`,
 * `format.emphasis` and `format.strong`. A value outside its schema is reported to invalid by name, in that order,
 * and replaced by its default; a missing value (undefined) takes its default silently.
 * @param get - The stored value of a setting, or undefined.
 */
export function read_settings(get: (name: string) => unknown, invalid: (name: string) => void): WorkspaceSettings {
  /* Validate each value in turn, converting it to its scheduler, parser or formatting form. */
  const scheduler = new SchedulerConfig()

  const queue_order = get('queueOrder')
  if (Array.isArray(queue_order) && queue_order.length === queues.length && queues.every(queue => queue_order.includes(queue))) {
    scheduler.queue_order = queue_order
  } else if (queue_order !== undefined) invalid('queueOrder')

  const rollover = get('rollover')
  const time = typeof rollover === 'string' ? rollover.trim().match(time_of_day) : null
  if (time) scheduler.rollover = (Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3] ?? 0)) * 1000
  else if (rollover !== undefined) invalid('rollover')

  const names = get('extensions') ?? []
  const known = Array.isArray(names) && names.every(name => optional_extensions.has(name))
  if (!known) invalid('extensions')

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

  /** A formatting option's setting holding one of the option's values, its default when missing or invalid. */
  const choice = <T extends keyof typeof format_choices>(name: string, option: T): FormatOptions[T] => {
    const value = get(name)
    const valid = (format_choices[option] as readonly unknown[]).includes(value)
    if (!valid && value !== undefined) invalid(name)
    return valid ? value as FormatOptions[T] : default_format_options[option]
  }
  const wrap = choice('format.wrap', 'wrap')
  const width = get('format.lineWidth')
  const valid_width = Number.isSafeInteger(width) && (width as number) >= min_line_width
  if (!valid_width && width !== undefined) invalid('format.lineWidth')
  const format: FormatOptions = {
    wrap, line_width: valid_width ? width as number : default_format_options.line_width,
    numbering: choice('format.numbering', 'numbering'), bullet: choice('format.bullet', 'bullet'),
    table_delimiters: choice('format.tableDelimiters', 'table_delimiters'), emphasis: choice('format.emphasis', 'emphasis'),
    strong: choice('format.strong', 'strong')
  }

  return {
    suffixes: valid_suffixes ? suffixes : ['.sr.md'],
    scheduler,
    inactive,
    extensions: known ? names.map(name => optional_extensions.get(name)!) : [],
    format
  }
}

/** The names of the optional Markdown extensions the `extensions` setting accepts, for a host's settings page. */
export function extension_names(): string[] {
  return [...optional_extensions.keys()]
}
