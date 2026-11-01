/** The app's settings: the shared workspace settings plus which files open in the app and which are skipped. */
import { read_settings, type FileTypes, type WorkspaceSettings } from '@srmd/workspace'

/**
 * The settings as the app stores them, through the shell, as JSON: the shared ones under VS Code's names without its
 * `srmd.` prefix (see read_settings()), and the Android ones. Only values the user changed need be present.
 */
export interface StoredSettings {
  suffixes?: string[]
  queueOrder?: string[]
  /** Local time of day the review day starts, `hh:mm`. */
  rollover?: string
  'inactive.front'?: boolean
  'inactive.back'?: boolean
  /** File name extensions opened as Markdown, such as `.md`. */
  markdown?: string[]
  /** File name extensions opened as plain text, such as `.txt`. */
  text?: string[]
  /** Name patterns of files and folders the scan skips; `*` matches any characters. */
  skip?: string[]
}

/** The settings in effect. */
export interface AppSettings extends WorkspaceSettings {
  types: FileTypes
  skip: string[]
}

/** The common Markdown and plain-text file name extensions, which open in the app unless the settings say otherwise. */
export const default_types: FileTypes = {
  markdown: ['.md', '.markdown', '.mdown', '.mkd', '.mkdn', '.mdwn', '.mdtxt', '.mdtext'],
  text: ['.txt', '.text', '.log', '.csv', '.tsv', '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.xml']
}

/** Hidden files and folders, such as `.git`, and installed packages are not notes. */
export const default_skip = ['.*', 'node_modules']

/** A list of non-empty strings, or null for anything else. */
function strings(value: unknown): string[] | null {
  return Array.isArray(value) && value.every(item => typeof item === 'string' && item) ? value : null
}

/** A list of file name extensions: each lowercase and starting with a dot after another character, such as `.md`. */
function extensions(value: unknown): string[] | null {
  const list = strings(value)
  return list && list.every(item => /^\.[^./\\]+$/.test(item) && item === item.toLowerCase()) ? list : null
}

/**
 * The settings in effect for stored values: the shared ones validated by read_settings(), the Android ones here. A
 * stored value outside its schema is reported to invalid by name and replaced by its default.
 */
export function app_settings(stored: StoredSettings, invalid: (name: string) => void): AppSettings {
  /* Validate the shared values first, then each Android value in turn. */
  const values = stored as { [name: string]: unknown }
  const shared = read_settings(name => values[name], invalid)
  /** A validated list, or its default with a report when the stored value is invalid. */
  const list = (name: 'markdown' | 'text' | 'skip', valid: (value: unknown) => string[] | null, fallback: string[]): string[] => {
    if (stored[name] === undefined) return fallback
    const value = valid(stored[name])
    if (!value) invalid(name)
    return value ?? fallback
  }
  return {
    ...shared,
    types: { markdown: list('markdown', extensions, default_types.markdown), text: list('text', extensions, default_types.text) },
    skip: list('skip', strings, default_skip)
  }
}

/**
 * The items of a list typed into a settings field: separated by commas or whitespace, trimmed, without empty items
 * or repeats. Extensions are lowercased and get a leading dot when it is missing.
 */
export function parse_list(text: string, kind: 'extensions' | 'names'): string[] {
  /* Split and normalize, keeping the first occurrence of each item. */
  const items: string[] = []
  for (const part of text.split(/[\s,]+/)) {
    if (!part) continue
    const item = kind === 'extensions' ? (part.startsWith('.') ? part : `.${part}`).toLowerCase() : part
    if (!items.includes(item)) items.push(item)
  }
  return items
}
