/** View mode: a file rendered for reading, every cloze shown and outlined, and where its links lead. */
import type MarkdownIt from 'markdown-it'
import { parse, render } from '@srmd/parser'
import { get_parent } from '@srmd/scheduler'
import { escape_html } from '@srmd/ui'
import type { FileKind } from '@srmd/workspace'

/** The path under the app's origin where the shell serves the notes folder's files (ARCHITECTURE.md, "URLs"). */
export const NOTES_PATH = '/notes/'

/** A path's segments URL-encoded, keeping the slashes between them. */
const encode_path = (path: string): string => path.split('/').map(encodeURIComponent).join('/')

/**
 * The URL of the folder holding the file at path, ending in a slash: the base relative URLs in the file resolve
 * against, such as its images.
 * @param origin - The app's origin, such as `https://appassets.androidplatform.net`.
 */
export function folder_url(origin: string, path: string): string {
  const folder = get_parent(path) || ''
  return `${origin}${NOTES_PATH}${folder ? `${encode_path(folder)}/` : ''}`
}

/**
 * Where a link leads: an element of the same file by id, a file of the folder (with the fragment after `#`, or ''),
 * or a URL to open outside the app.
 */
export type LinkTarget = { kind: 'fragment'; id: string } | { kind: 'file'; path: string; fragment: string } | { kind: 'url'; url: string }

/** URL schemes opened outside the app; any other scheme, such as `javascript:`, leads nowhere. */
const outside_schemes = ['http:', 'https:', 'mailto:', 'tel:', 'geo:', 'sms:']

/**
 * Where the link href in the file at from leads, or null where it leads nowhere, as outside the notes folder.
 * Relative links resolve against the file's folder and absolute paths against the app's origin, where the notes folder
 * is NOTES_PATH: Foam's links and markdown-it's write a path from the folder's root, `/topic/a.md`, below it (foam.ts).
 */
export function link_target(href: string, from: string): LinkTarget | null {
  /*
   * 1. A fragment alone names an element of the file itself.
   * 2. A link with a scheme is a URL outside the app, if its scheme is one the app opens.
   * 3. Anything else is a path: resolve it as a URL under a placeholder origin, then decode the path back.
   */
  if (href.startsWith('#')) return { kind: 'fragment', id: decode(href.slice(1)) }
  const scheme = href.match(/^([a-z][a-z0-9+.-]*:)/i)?.[1].toLowerCase()
  if (scheme) return outside_schemes.includes(scheme) ? { kind: 'url', url: href } : null
  const origin = 'https://notes.invalid'
  let url: URL
  try {
    url = new URL(href, folder_url(origin, from))
  } catch {
    return null
  }
  if (url.origin !== origin || !url.pathname.startsWith(NOTES_PATH)) return null
  const path = decode(url.pathname.slice(NOTES_PATH.length))
  return path ? { kind: 'file', path, fragment: decode(url.hash.slice(1)) } : null
}

/** A URL component decoded, or kept as written when it is not valid percent-encoding. */
function decode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/**
 * The HTML of a file in view mode: Markdown, including notes, rendered with md, the library's (see foam.ts), which
 * renders srmd's syntax and Foam's; text preformatted.
 */
export function file_html(text: string, kind: FileKind, md: MarkdownIt): string {
  if (kind === 'text') return `<pre class="plain">${escape_html(text)}</pre>`
  return render(parse(text, md))
}

/**
 * The pane showing a file in view mode. It is the scroll container, so the note search's highlight boxes, which the
 * shared Search places in its content's scrolled coordinates, scroll with the text.
 */
export class NoteView {
  /** The path of the file shown, or null. */
  path: string | null = null

  /** Render into element, the pane. */
  constructor(readonly element: HTMLElement) {}

  /**
   * Show a file's text rendered with md (see file_html()), scrolled to scroll. The document's base moves to the
   * file's folder first, so its relative images load from there as they are inserted.
   */
  show(path: string, text: string, kind: FileKind, md: MarkdownIt, scroll = 0): void {
    /* Point the base at the file's folder, insert the rendered file, wrap wide blocks, then restore the scroll position. */
    document.querySelector('base')!.href = folder_url(location.origin, path)
    this.path = path
    this.element.innerHTML = `<article class="note">${file_html(text, kind, md)}</article>`
    // Tables scroll sideways in a wrapper; the wrapper keeps horizontal swipes inside it rather than opening the drawer.
    for (const table of Array.from(this.element.querySelectorAll('table'))) {
      const wrapper = document.createElement('div')
      wrapper.className = 'wide'
      table.replaceWith(wrapper)
      wrapper.appendChild(table)
    }
    this.element.scrollTop = scroll
  }

  /** Show nothing. */
  clear(): void {
    this.path = null
    this.element.innerHTML = ''
  }

  /** Scroll to the element with this id, such as a footnote; false when there is none. */
  reveal(id: string): boolean {
    const target = Array.from(this.element.querySelectorAll<HTMLElement>('[id]')).find(element => element.id === id)
    target?.scrollIntoView({ block: 'start' })
    return target !== undefined
  }
}
