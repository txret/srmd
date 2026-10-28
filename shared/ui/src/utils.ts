/** Modifier names a shortcut may contain, each matching the KeyboardEvent property `<name>Key`. */
const modifiers = ['ctrl', 'shift', 'alt', 'meta'] as const

/**
 * Whether a key event matches a configured shortcut such as `ctrl+f` or `Space`.
 * Names are case-insensitive; every modifier in the shortcut must be held and no other modifier.
 */
export function shortcut_matches(event: KeyboardEvent, shortcut: string): boolean {
  /* Normalize the shortcut's parts and the event key, then compare the key and all four modifiers. */
  const normalize = (value: string): string => {
    const key = value.toLowerCase()
    return key === 'space' || key === 'spacebar' ? ' ' : key
  }
  const parts = new Set(shortcut.split('+').map(normalize))
  return parts.has(normalize(event.key)) && modifiers.every(modifier => event[`${modifier}Key`] === parts.has(modifier))
}

/** Escape plain text for HTML element content or a double-quoted attribute value. */
export function escape_html(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
