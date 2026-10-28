/** The web app's end of the native shell's message channel (ARCHITECTURE.md, "Bridge messages"). */
import type { FileEntry } from '@srmd/workspace'
import type { StoredSettings } from './settings'

/** Why the shell refused a request. */
export type ErrorCode = 'no_root' | 'not_found' | 'conflict' | 'denied' | 'no_app' | 'io'

/** A request the shell refused, with its error code. */
export class BridgeError extends Error {
  /** Carry the shell's code, which callers branch on, and its message, which is logged. */
  constructor(readonly code: ErrorCode, message: string) {
    super(message)
  }
}

/** The folder the user picked, by its display name. */
export interface Root {
  name: string
}

/** System bars and keyboard in CSS pixels: the page pads its fixed parts by them, since it draws edge to edge. */
export interface Insets {
  top: number
  /** The navigation bar, or the keyboard while it is shown, whichever is taller. */
  bottom: number
  left: number
  right: number
  keyboard: boolean
}

/** Every request: its params and its result. */
export interface Methods {
  /** The first request of a page: what it needs to start. settings is null until the app stored some. */
  'app.start': { params: Record<string, never>; result: { settings: StoredSettings | null; root: Root | null; language: string; insets: Insets } }
  'settings.set': { params: { settings: StoredSettings }; result: Record<string, never> }
  /** Show the system folder picker; root is null when the user cancelled. A new root replaces the old one. */
  'root.pick': { params: Record<string, never>; result: { root: Root | null } }
  /** Every file below the root, skipping files and folders whose names match a pattern (`*` any characters). */
  'files.scan': { params: { skip: string[] }; result: { entries: FileEntry[] } }
  /** A file's text with the time and size it had when read. */
  'files.read': { params: { path: string }; result: { text: string; mtime: number; size: number } }
  /** A file's text alone, for loading notes a scan just listed with their times and sizes; cheaper than files.read. */
  'files.load': { params: { path: string }; result: { text: string } }
  /** Replace a file's text; with expected_mtime, refused as `conflict` when the file's time differs. */
  'files.write': { params: { path: string; text: string; expected_mtime?: number }; result: { mtime: number; size: number } }
  /** Open a file in the Android app that handles its type; `no_app` when none does. */
  'files.open': { params: { path: string }; result: Record<string, never> }
  /** Open a URL outside the app, such as a web page in the browser. */
  'link.open': { params: { url: string }; result: Record<string, never> }
  /** Whether Back closes something in the page; otherwise Android handles it, leaving the app. */
  'back.set': { params: { handled: boolean }; result: Record<string, never> }
  /**
   * Show the keyboard for the field the page just focused. The WebView shows it by itself only when a tap focused the
   * field, not a swipe.
   */
  'keyboard.show': { params: Record<string, never>; result: Record<string, never> }
}

/** Every event the shell sends, with its params. */
export interface Events {
  /** Back was pressed while the page reported something open. */
  back: Record<string, never>
  /** The app returned to the foreground after away milliseconds in the background. */
  resume: { away: number }
  /** The app goes to the background, where Android may end it. */
  pause: Record<string, never>
  insets: Insets
}

/** The object the shell injects as `srmd`: postMessage() sends to the shell, onmessage receives its messages. */
export interface Channel {
  postMessage(message: string): void
  onmessage: ((event: { data: unknown }) => void) | null
}

/** A message from the shell: a reply to request id, or an event. */
type Incoming =
  | { id: number; result: unknown }
  | { id: number; error: { code: ErrorCode; message: string } }
  | { event: keyof Events; params?: unknown }

/** Typed requests with promised replies, and event subscriptions, over the shell's channel. Messages are JSON. */
export class Bridge {
  /** Identifies each request, so its reply settles its promise. */
  private next_id = 1
  /** Requests awaiting their replies, by id. */
  private pending: { [id: number]: { resolve: (result: unknown) => void; reject: (error: unknown) => void } } = {}
  /** Event listeners by event name. */
  private listeners: { [event: string]: ((params: unknown) => void)[] } = {}

  /** Listen on channel; the shell answers each request and sends events once the page has sent a request. */
  constructor(private readonly channel: Channel) {
    channel.onmessage = event => this.receive(event.data)
  }

  /** Send a request; the promise settles with the shell's result, or rejects with a BridgeError. */
  request<M extends keyof Methods>(method: M, params: Methods[M]['params']): Promise<Methods[M]['result']> {
    const id = this.next_id++
    return new Promise((resolve, reject) => {
      this.pending[id] = { resolve: resolve as (result: unknown) => void, reject }
      this.channel.postMessage(JSON.stringify({ id, method, params }))
    })
  }

  /** Call listener with the params of every later event of this name. */
  on<E extends keyof Events>(event: E, listener: (params: Events[E]) => void): void {
    (this.listeners[event] ??= []).push(listener as (params: unknown) => void)
  }

  /** Settle a reply's request or deliver an event; anything else is logged and dropped. */
  private receive(data: unknown): void {
    /* Parse the JSON text, then dispatch by its shape. */
    let message: Incoming
    try {
      message = JSON.parse(String(data)) as Incoming
    } catch {
      console.error('srmd: unreadable message from the shell', data)
      return
    }
    if ('event' in message) {
      for (const listener of this.listeners[message.event] ?? []) listener(message.params ?? {})
      return
    }
    const request = this.pending[message.id]
    if (!request) return
    delete this.pending[message.id]
    if ('error' in message) request.reject(new BridgeError(message.error.code, message.error.message))
    else request.resolve(message.result)
  }
}
