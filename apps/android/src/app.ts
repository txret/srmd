/**
 * The app: the shown file, the stack of what is open over it, and the flows between them (ARCHITECTURE.md, "Screen
 * and interaction" and "Data flow"). Views render; the App decides.
 */
import { m } from '@srmd/l10n'
import { NOTE, get_counts, get_name } from '@srmd/scheduler'
import { UIConfig, ui_labels } from '@srmd/ui'
import { error_text, tree_rows, type Log, type PreparedCard } from '@srmd/workspace'
import { BridgeError, type Bridge, type Insets, type Root } from './bridge'
import type { Cache } from './cache'
import { Dialog, Toast, type Choice } from './dialog'
import { Drawer } from './drawer'
import { Editor } from './editor'
import { attach_gestures } from './gestures'
import { icons } from './icons'
import { Library } from './library'
import { search_files } from './library_search'
import { NoteSearch } from './note_search'
import { NoteView, link_target } from './note_view'
import { ReviewView } from './review_view'
import { app_settings, type AppSettings, type StoredSettings } from './settings'
import { SettingsView } from './settings_view'
import { AndroidStorage } from './storage'
import { TreeView } from './tree_view'

/**
 * Something opened over or instead of the shown file. They form one stack, in opening order, and Back closes the
 * last: so Back needs no rules of its own. Review, edit and link layers decide what the main view shows (see mode()).
 */
export type Layer =
  /** A question; Back answers it with cancel. */
  | { kind: 'dialog'; cancel: string }
  | { kind: 'settings' }
  | { kind: 'drawer' }
  /** A search in the drawer, filtering the tree; Back clears it. */
  | { kind: 'drawer_search' }
  /** The note search bar, or in review the reviewer's own search. */
  | { kind: 'note_search' }
  /** Reviewing a note or folder path; card is the one shown, null while selecting. */
  | { kind: 'review'; scope: string; card: PreparedCard | null }
  /** Editing the file at path; base is its text when editing began, which saving compares with the file. */
  | { kind: 'edit'; path: string; base: string }
  /** A file opened from a link; from_scroll is where the file shown before was scrolled, restored by Back. */
  | { kind: 'link'; path: string; from_scroll: number }

/** What the main view shows. */
export type Mode = 'view' | 'review' | 'edit' | 'empty'

/** The elements the app runs in, from index.html. */
export interface Elements {
  main: HTMLElement
  view: HTMLElement
  review: HTMLElement
  editor: HTMLElement
  empty: HTMLElement
  note_search: HTMLElement
  handle: HTMLElement
  scrim: HTMLElement
  drawer: HTMLElement
  tree: HTMLElement
  library_search: HTMLInputElement
  toggle: HTMLButtonElement
  review_shown: HTMLButtonElement
  open_settings: HTMLButtonElement
  settings: HTMLElement
  dialog: HTMLElement
  toast: HTMLElement
}

/** How long the app must have been away before returning rescans the folder: a sync has probably run meanwhile. */
const RESCAN_AFTER = 15 * 60_000

/** The most log lines kept for the settings page. */
const LOG_LINES = 300

/** The app. Created by main once the shell answered app.start and the language is set. */
export class App {
  /** What is open, the last opened last (see Layer). */
  readonly layers: Layer[] = []
  /** The file shown in view mode below every layer; null before one is chosen. */
  private path: string | null = null
  /** The text rendered in view mode, so a reread renders again only when it changed. */
  private shown_text: string | null = null
  private settings: AppSettings
  private library: Library | null = null
  /** Folder paths expanded in the tree. */
  private expanded: { [path: string]: boolean } = Object.create(null)
  /** The drawer search's matches, or null while it is not searching. */
  private matches: { [path: string]: number } | null = null
  /** Counts the drawer searches, so reads for an earlier search stop and do not redraw. */
  private search_generation = 0
  /** Whether the shell was last told that Back closes something here. */
  private back_handled = false
  /** Whether the tree must be drawn again before the drawer next shows. */
  private tree_stale = true
  /** The once-a-minute recount while in the foreground, for due-time and review-day transitions. */
  private timer = 0
  /** The status line of the settings page: scanning, or what the last scan found. */
  private scan_status = ''
  /** Recent log lines, newest last, for the settings page. */
  private readonly log_lines: string[] = []

  private readonly config = new UIConfig(ui_labels())
  private readonly view: NoteView
  private readonly reviewer: ReviewView
  private readonly editor: Editor
  private readonly tree: TreeView
  private readonly note_search: NoteSearch
  private readonly drawer: Drawer
  private readonly settings_view: SettingsView
  private readonly dialog: Dialog
  private readonly toast: Toast

  /** The log the workspace and the app write to: kept for the settings page and passed to the console. */
  readonly log: Log = {
    info: message => this.record('info', message),
    warn: message => this.record('warn', message),
    error: message => this.record('error', message)
  }

  /**
   * Create the views in elements and connect their controls; nothing is read until start().
   * @param stored - The settings the shell keeps, as the user changed them.
   * @param root - The notes folder, or null until the user picks one.
   */
  constructor(
    private readonly bridge: Bridge, private readonly cache: Cache, private readonly elements: Elements,
    private stored: StoredSettings, private root: Root | null
  ) {
    /*
     * 1. Settings in effect, and the reviewer's display settings, following the system's dark mode.
     * 2. Views over their elements, with their handlers.
     * 3. The drawer's search field and bottom bar, links, gestures and the shell's events.
     */
    this.settings = app_settings(stored, name => this.log.warn(m.android_setting_invalid({ name })))
    this.config.inactive = this.settings.inactive
    const dark = matchMedia('(prefers-color-scheme: dark)')
    this.config.night_mode = dark.matches
    dark.addEventListener('change', () => { this.config.night_mode = dark.matches })

    this.view = new NoteView(elements.view)
    this.reviewer = new ReviewView(elements.review, this.config, open => this.follow_search(open))
    this.editor = new Editor(elements.editor, open => this.follow_search(open))
    this.tree = new TreeView(elements.tree, {
      open: path => void this.open(path),
      toggle: path => this.toggle_folder(path),
      review: path => void this.review(path)
    })
    this.note_search = new NoteSearch(elements.note_search, elements.view, () => this.close_note_search())
    this.drawer = new Drawer(elements.drawer, elements.scrim)
    this.settings_view = new SettingsView(elements.settings, {
      pick_root: () => void this.pick_root(),
      rescan: () => void this.rescan(),
      change: stored => void this.change_settings(stored),
      close: () => this.close_settings()
    })
    this.dialog = new Dialog(elements.dialog)
    this.toast = new Toast(elements.toast)

    elements.library_search.placeholder = m.android_search_files()
    elements.library_search.setAttribute('aria-label', m.android_search_files())
    let search_timer = 0
    elements.library_search.addEventListener('input', () => {
      clearTimeout(search_timer)
      search_timer = window.setTimeout(() => this.search_library(), 200)
    })
    elements.toggle.addEventListener('click', () => void this.toggle_edit())
    elements.review_shown.innerHTML = icons.play
    elements.review_shown.setAttribute('aria-label', m.android_review_note())
    elements.review_shown.addEventListener('click', () => {
      const path = this.shown_path()
      if (path) void this.review(path)
    })
    elements.open_settings.innerHTML = icons.gear
    elements.open_settings.setAttribute('aria-label', m.android_settings())
    elements.open_settings.addEventListener('click', () => this.show_settings())
    elements.empty.innerHTML = `<p>${m.android_empty()}</p>`
    // Links are followed here in the capture phase, before the page could navigate or the reviewer toggle a cloze.
    document.addEventListener('click', event => this.click_link(event), true)

    attach_gestures(elements.main, elements.drawer, elements.scrim, elements.handle, {
      drawer_open: () => this.drawer.open,
      drawer_width: () => this.drawer.width,
      drag_drawer: shown => {
        // Draw the tree as the drawer starts to show, so it slides out with its rows.
        if (shown !== null && this.tree_stale) this.render_tree()
        this.drawer.drag(shown)
      },
      set_drawer: open => this.set_drawer(open),
      open_search: () => this.open_note_search()
    })
    bridge.on('back', () => void this.back())
    bridge.on('insets', insets => this.apply_insets(insets))
    bridge.on('pause', () => this.pause())
    bridge.on('resume', ({ away }) => this.resume(away))
    this.render()
  }

  /**
   * Show the last session at once, then bring it up to date: the last listing as the tree, an unsaved edit or the last
   * file, then a scan in the background, which loads the notes. Without a notes folder, the settings page opens.
   */
  async start(insets: Insets): Promise<void> {
    /* Restore what was kept, then scan; the main view and the tree update as the scan's results arrive. */
    this.apply_insets(insets)
    if (!this.root) {
      this.show_settings()
      return
    }
    this.library = this.create_library(this.root)
    this.library.list(await this.cache.value('files') ?? [])
    Object.assign(this.expanded, await this.cache.value('expanded') ?? {})
    const draft = await this.cache.value('draft')
    const last = await this.cache.value('last')
    if (draft) await this.restore_draft(draft.path, draft.text, draft.base)
    else if (last) await this.open(last)
    this.render()
    this.start_timer()
    await this.rescan()
  }

  // Layers ---------------------------------------------------------------------------------------------------------

  /** Close the last layer opened, as Back does. */
  async back(): Promise<void> {
    const top = this.layers.at(-1)
    if (top) await this.close_layer(top)
  }

  /**
   * Close a layer: answer a dialog, clear the drawer's search, close the drawer, settings or a search, end a review,
   * leave edit mode (asking to save a change) or return from a link. false when it stays open, as when the user keeps
   * editing; a dialog's asker closes it after the answer, so it returns false too.
   */
  private async close_layer(layer: Layer): Promise<boolean> {
    switch (layer.kind) {
      case 'dialog':
        this.dialog.answer(layer.cancel)
        return false
      case 'settings':
        this.close_settings()
        return true
      case 'drawer_search':
        this.clear_library_search()
        return true
      case 'drawer':
        this.set_drawer(false)
        return true
      case 'note_search':
        this.close_note_search()
        return true
      case 'review':
        this.end_review(layer)
        return true
      case 'edit':
        return this.leave_edit(layer)
      case 'link':
        await this.leave_link(layer)
        return true
    }
  }

  /** Close every layer, last first, as opening a file from the drawer does; false when one stays open. */
  private async close_all(): Promise<boolean> {
    for (let top = this.layers.at(-1); top; top = this.layers.at(-1)) {
      if (top.kind === 'dialog' || !await this.close_layer(top)) return false
    }
    return true
  }

  /** Open a layer. */
  private push(layer: Layer): void {
    this.layers.push(layer)
    this.render()
  }

  /** Remove a layer, wherever it is in the stack. */
  private remove(layer: Layer): void {
    const index = this.layers.indexOf(layer)
    if (index !== -1) this.layers.splice(index, 1)
    this.render()
  }

  /** The open layer of a kind nearest the top, if any. */
  private find<K extends Layer['kind']>(kind: K): Extract<Layer, { kind: K }> | undefined {
    for (let index = this.layers.length - 1; index >= 0; index--) {
      const layer = this.layers[index]
      if (layer.kind === kind) return layer as Extract<Layer, { kind: K }>
    }
    return undefined
  }

  /** The topmost review, edit or link layer, which decides what the main view shows. */
  private content_layer(): Extract<Layer, { kind: 'review' | 'edit' | 'link' }> | undefined {
    for (let index = this.layers.length - 1; index >= 0; index--) {
      const layer = this.layers[index]
      if (layer.kind === 'review' || layer.kind === 'edit' || layer.kind === 'link') return layer
    }
    return undefined
  }

  /** What the main view shows: the topmost review or edit, a linked file in view mode, else the shown file if any. */
  mode(): Mode {
    const layer = this.content_layer()
    if (layer?.kind === 'review') return 'review'
    if (layer?.kind === 'edit') return 'edit'
    return layer || this.path ? 'view' : 'empty'
  }

  /** The path of the file the main view shows: being edited, reviewed, opened from a link, or the shown file. */
  shown_path(): string | null {
    const layer = this.content_layer()
    if (layer?.kind === 'review') return layer.card?.path ?? null
    return layer ? layer.path : this.path
  }

  /** Show the mode and the drawer's controls for the current layers, and tell the shell whether Back is handled here. */
  private render(): void {
    /* Panes and bars follow the stack; the shell hears only when whether anything is open changes. */
    const mode = this.mode()
    this.elements.main.dataset.mode = mode
    const shown = this.shown_path()
    const kind = shown && this.library ? this.library.kind(shown) : 'other'
    const toggle = this.elements.toggle
    toggle.innerHTML = mode === 'edit' ? icons.eye : icons.markdown
    toggle.setAttribute('aria-label', mode === 'edit' ? m.android_view_mode() : m.android_edit_mode())
    toggle.disabled = !shown || kind === 'other'
    const node = shown ? this.library?.workspace.state.nodes[shown] : undefined
    const counts = node?.type === NOTE ? get_counts(node) : null
    this.elements.review_shown.disabled = !counts || !(counts.due + counts.new) || mode === 'review'
    for (const row of Array.from(this.elements.tree.querySelectorAll<HTMLElement>('.row'))) {
      row.classList.toggle('selected', row.dataset.path === shown)
    }
    const handled = this.layers.length > 0
    if (handled !== this.back_handled) {
      this.back_handled = handled
      this.bridge.request('back.set', { handled }).catch(() => undefined)
    }
  }

  /** Ask a question as a dialog layer, which Back answers with cancel. */
  private async ask(message: string, choices: Choice[], cancel: string): Promise<string> {
    const layer: Layer = { kind: 'dialog', cancel }
    this.push(layer)
    try {
      return await this.dialog.ask(message, choices)
    } finally {
      this.remove(layer)
    }
  }

  // Files ----------------------------------------------------------------------------------------------------------

  /**
   * Show a file. From the drawer or at start, it replaces whatever is shown and closes everything open, as long as an
   * edit is saved or discarded; from a link, it opens over the current file, and Back returns. Files that do not
   * open in the app open in their Android app. A fragment scrolls to its element; a query opens the note search on it.
   */
  async open(path: string, options: { link?: boolean; fragment?: string; query?: string } = {}): Promise<void> {
    /*
     * 1. Hand other files to Android.
     * 2. Close what the file replaces: everything from the drawer, only the note search for a link.
     * 3. Read the file, then show it as the shown file or as a link layer, and remember it for the next start.
     */
    const library = this.library
    if (!library) return
    if (!library.opens(path)) {
      await this.open_outside(path)
      return
    }
    const scroll = this.elements.view.scrollTop
    if (options.link) {
      if (this.find('note_search')) this.close_note_search()
    } else if (!await this.close_all()) return
    let text: string
    try {
      text = await library.read(path)
    } catch (error: unknown) {
      this.failed(m.android_read_failed({ path, detail: error_text(error) }), error)
      // The next start shows what shows now, not a file that could not be read, as one a sync deleted.
      this.cache.set_value('last', this.path ?? undefined)
      return
    }
    if (options.link) this.push({ kind: 'link', path, from_scroll: scroll })
    else {
      this.path = path
      this.cache.set_value('last', path)
    }
    this.show_view(path, text)
    this.render()
    if (options.fragment) this.view.reveal(options.fragment)
    if (options.query) this.open_note_search(options.query)
  }

  /**
   * Render a file's text in view mode, keeping its scroll position when it is the file shown already. An open search of
   * the view closes, as its highlights belong to the text replaced.
   */
  private show_view(path: string, text: string, scroll?: number): void {
    const library = this.library!
    if (this.find('note_search') && this.mode() === 'view') this.close_note_search()
    const keep = this.view.path === path ? this.elements.view.scrollTop : 0
    this.view.show(path, text, library.kind(path), library.foam.md, scroll ?? keep)
    this.shown_text = text
    void this.show_links(path, text)
  }

  /**
   * Show the file in view mode again once Foam has read what its wiki links and embeds point at (Foam.prepare()), with
   * the files' titles and the files embedded, unless another text shows by then. A file without wiki links needs none.
   */
  private async show_links(path: string, text: string): Promise<void> {
    /* Prepare in a task, as Foam's view of the folder follows the scans; render again for the same file, text and mode. */
    const library = this.library!
    const kind = library.kind(path)
    if (kind === 'text' || !text.includes('[[')) return
    await library.workspace.run(() => library.foam.prepare(path, text))
    if (this.library !== library || this.view.path !== path || this.shown_text !== text || this.mode() !== 'view') return
    this.view.show(path, text, kind, library.foam.md, this.elements.view.scrollTop)
  }

  /** Read the file the main view shows in view mode again, rendering it when it changed. */
  private async refresh_view(scroll?: number): Promise<void> {
    const path = this.shown_path()
    if (this.mode() !== 'view' || !path || !this.library) return
    try {
      const text = await this.library.read(path)
      if (path !== this.shown_path()) return
      if (text !== this.shown_text || this.view.path !== path || scroll !== undefined) this.show_view(path, text, scroll)
    } catch (error: unknown) {
      this.failed(m.android_read_failed({ path, detail: error_text(error) }), error)
    }
  }

  /** Return from a link: the file shown before it, where it was scrolled. */
  private async leave_link(layer: Extract<Layer, { kind: 'link' }>): Promise<void> {
    this.remove(layer)
    await this.refresh_view(layer.from_scroll)
  }

  /** Open a file in the Android app for its type. */
  private async open_outside(path: string): Promise<void> {
    try {
      await this.bridge.request('files.open', { path })
    } catch (error: unknown) {
      const message = error instanceof BridgeError && error.code === 'no_app' ? m.android_no_app({ name: get_name(path) }) : error_text(error)
      this.failed(message, error)
    }
  }

  /** Follow a link tapped in the shown file: its element, another file over this one, or a URL outside the app. */
  private click_link(event: MouseEvent): void {
    /*
     * 1. Only links in the shown file count; the page itself never navigates. A link in a hidden cloze of the card
     *    under review is part of the cloze, which the reviewer reveals.
     * 2. Resolve the link against the file and act on its target. A link to a missing file is tried with the Markdown
     *    and note extensions, as Foam writes links without them.
     */
    const anchor = (event.target as Element).closest?.('a[href]')
    if (!anchor || !(this.elements.view.contains(anchor) || this.elements.review.contains(anchor))) return
    event.preventDefault()
    if (this.elements.review.contains(anchor) && anchor.closest('.cloze.hide')) return
    event.stopPropagation()
    const target = link_target(anchor.getAttribute('href')!, this.shown_path() ?? '')
    if (!target || !this.library) return
    if (target.kind === 'url') {
      this.bridge.request('link.open', { url: target.url }).catch((error: unknown) => this.failed(error_text(error), error))
      return
    }
    if (target.kind === 'fragment') {
      const pane = this.mode() === 'review' ? this.elements.review : this.elements.view
      Array.from(pane.querySelectorAll<HTMLElement>('[id]')).find(element => element.id === target.id)?.scrollIntoView({ block: 'start' })
      return
    }
    const library = this.library
    // A file read since the last scan, such as one just synced, has a storage entry although the listing lacks it.
    const listed = new Set(library.files.map(file => file.path))
    const exists = (path: string): boolean => listed.has(path) || library.storage.entry(path) !== undefined
    const candidates = [target.path, ...['.md', ...this.settings.suffixes].map(suffix => target.path + suffix)]
    const path = candidates.find(exists)
    if (!path) {
      this.toast.show(m.android_file_missing({ path: target.path }))
      return
    }
    if (path === this.shown_path() && this.mode() === 'view') {
      if (target.fragment) this.view.reveal(target.fragment)
      return
    }
    void this.open(path, { link: true, fragment: target.fragment })
  }

  // Drawer ---------------------------------------------------------------------------------------------------------

  /** Slide the drawer out, as a layer, or back, closing its search. */
  private set_drawer(open: boolean): void {
    /* Draw the tree as the drawer opens, in the same task; closing drops the search layer first, as it belongs to the drawer. */
    if (open === this.drawer.open) {
      this.drawer.drag(null)
      return
    }
    if (open) {
      this.push({ kind: 'drawer' })
      this.drawer.open = true
      this.render_tree()
      this.tree.reveal_selected()
      return
    }
    const search = this.find('drawer_search')
    if (search) this.clear_library_search()
    const drawer = this.find('drawer')
    if (drawer) this.remove(drawer)
    this.drawer.open = false
    this.elements.library_search.blur()
  }

  /** Draw the tree's visible rows, or note that it must be drawn before the drawer next shows. */
  private render_tree(): void {
    const library = this.library
    if (!library || (!this.drawer.open && !this.elements.drawer.classList.contains('dragging'))) {
      this.tree_stale = true
      if (!library) this.tree.render([], null)
      return
    }
    this.tree_stale = false
    const rows = tree_rows(library.workspace.state, library.children, library.root_name, path => library.kind(path),
      this.expanded, this.matches ?? undefined)
    this.tree.render(rows, this.shown_path())
  }

  /** Expand or collapse a folder of the tree, keeping the choice for the next start. */
  private toggle_folder(path: string): void {
    if (this.matches) return
    if (this.expanded[path]) delete this.expanded[path]
    else this.expanded[path] = true
    this.cache.set_value('expanded', { ...this.expanded })
    this.render_tree()
  }

  /**
   * Search all files for the drawer's query: the tree shows the matches, by name or text (see search_files()). Files
   * whose texts were never read are read in the background, the results growing as they arrive. The first search
   * opens a layer, so Back clears it; an empty query clears it.
   */
  private search_library(): void {
    /* Start a new generation, so reads for an older query stop redrawing; match now, then again as texts arrive. */
    const library = this.library
    const query = this.elements.library_search.value.trim()
    if (!library) return
    const generation = ++this.search_generation
    if (!query) {
      this.clear_library_search()
      return
    }
    if (!this.find('drawer_search')) this.push({ kind: 'drawer_search' })
    const run = (): void => {
      const paths = library.files.map(file => file.path)
      this.matches = search_files(query, paths, path => library.opens(path) ? library.storage.current(path) : undefined)
      this.render_tree()
    }
    run()
    let pending = 0
    void library.read_uncached(() => {
      // Redraw at most every 20 files read, then once at the end.
      if (++pending % 20 === 0 && generation === this.search_generation) run()
    }, () => generation !== this.search_generation).then(() => {
      if (generation === this.search_generation && pending) run()
    })
  }

  /** End the drawer's search: the whole tree shows again. */
  private clear_library_search(): void {
    this.search_generation++
    this.elements.library_search.value = ''
    this.matches = null
    const layer = this.find('drawer_search')
    if (layer) this.remove(layer)
    this.render_tree()
  }

  // Note search ----------------------------------------------------------------------------------------------------

  /**
   * Open the search of the shown file, with query searched at once: the bar in view mode, the reviewer's own in review,
   * CodeMirror's search panel in edit mode.
   */
  private open_note_search(query = ''): void {
    /* The reviewer's and the editor's searches report themselves (see follow_search()); the bar is a layer of its own. */
    if (this.find('note_search') || this.drawer.open) return
    const mode = this.mode()
    if (mode === 'review') {
      if (this.reviewer.open_search()) this.show_keyboard()
      return
    }
    if (mode === 'edit') this.editor.open_search(query)
    else if (mode === 'view') {
      this.note_search.show(query)
      this.push({ kind: 'note_search' })
    } else return
    if (!query) this.show_keyboard()
  }

  /** Bring up the keyboard for the field just focused, which a swipe, unlike a tap, does not do by itself. */
  private show_keyboard(): void {
    this.bridge.request('keyboard.show', {}).catch(() => undefined)
  }

  /** Close the search of the shown file and its highlights. */
  private close_note_search(): void {
    this.note_search.hide()
    this.reviewer.close_search()
    this.editor.close_search()
    const layer = this.find('note_search')
    if (layer) this.remove(layer)
  }

  /** Follow a search opening or closing by itself, the reviewer's or CodeMirror's, so Back closes it. */
  private follow_search(open: boolean): void {
    const layer = this.find('note_search')
    if (open && !layer) this.push({ kind: 'note_search' })
    else if (!open && layer) this.remove(layer)
  }

  // Review ---------------------------------------------------------------------------------------------------------

  /** Review a note or folder: everything open closes first, then cards follow one another until none is left. */
  async review(scope: string): Promise<void> {
    if (!this.library || !await this.close_all()) return
    const layer: Extract<Layer, { kind: 'review' }> = { kind: 'review', scope, card: null }
    this.push(layer)
    await this.run_review(layer)
  }

  /**
   * The review loop, as in the VS Code host (ARCHITECTURE.md, "Review and persistence"): select the next card in a
   * task, show it and wait for a rating, then save it in a task. A rating for a note changed meanwhile is dropped
   * with a message; a failed save ends the review, leaving the card due.
   */
  private async run_review(layer: Extract<Layer, { kind: 'review' }>): Promise<void> {
    /* The loop ends when the layer closes, as Back or opening a file does, or when no card is left. */
    const workspace = this.library!.workspace
    try {
      while (this.layers.includes(layer)) {
        const card = await workspace.run(() => workspace.next_card(layer.scope))
        if (!this.layers.includes(layer)) return
        if (!card) {
          this.toast.show(m.android_no_more_cards({ name: layer.scope ? get_name(layer.scope) : this.library!.root_name }))
          this.end_review(layer)
          return
        }
        layer.card = card
        this.render()
        const rating = await this.reviewer.show(card)
        if (rating === null || !this.layers.includes(layer)) return
        const result = await workspace.run(() => workspace.rate(card, rating))
        if (result.status === 'failed') {
          this.failed(m.android_save_failed({ path: card.path, detail: error_text(result.error) }), result.error)
          this.end_review(layer)
          return
        }
        if (result.status === 'changed') {
          this.log.warn(m.workspace_note_changed({ path: card.path }))
          this.toast.show(m.workspace_note_changed({ path: card.path }))
        }
      }
    } catch (error: unknown) {
      this.failed(m.workspace_review_failed({ detail: error_text(error) }), error)
      this.end_review(layer)
    }
  }

  /** End a review: the main view shows the note reviewed last, in view mode. */
  private end_review(layer: Extract<Layer, { kind: 'review' }>): void {
    /* Closing the card ends the loop's wait; the shown file becomes the last note reviewed. */
    if (!this.layers.includes(layer)) return
    const search = this.find('note_search')
    if (search) this.close_note_search()
    this.reviewer.close()
    // Review starts with nothing else open, so below it is only the shown file, which becomes the last note reviewed;
    // a review that showed no card leaves it as it is.
    if (layer.card) {
      this.path = layer.card.path
      this.cache.set_value('last', this.path)
    }
    this.remove(layer)
    void this.refresh_view()
  }

  // Edit -----------------------------------------------------------------------------------------------------------

  /** Switch the shown file between view and edit mode, from the drawer's toggle, which closes the drawer. */
  async toggle_edit(): Promise<void> {
    /* Leaving edit mode may ask to save; entering reads the file again, which becomes the edit's base. */
    this.set_drawer(false)
    const layer = this.content_layer()
    if (layer?.kind === 'edit') {
      await this.leave_edit(layer)
      return
    }
    const path = this.shown_path()
    const library = this.library
    if (!path || !library || !library.opens(path)) return
    const search = this.find('note_search')
    if (search) this.close_note_search()
    let text: string
    try {
      text = await library.read(path)
    } catch (error: unknown) {
      this.failed(m.android_read_failed({ path, detail: error_text(error) }), error)
      return
    }
    this.editor.open(text, library.kind(path), library.foam.md)
    this.push({ kind: 'edit', path, base: text })
  }

  /** Reopen an edit Android ended before it was saved, from its draft: the edited text over the file it started from. */
  private async restore_draft(path: string, text: string, base: string): Promise<void> {
    await this.open(path)
    if (this.path !== path) return
    this.editor.open(text, this.library!.kind(path), this.library!.foam.md, base)
    this.push({ kind: 'edit', path, base })
    this.toast.show(m.android_draft_restored({ name: get_name(path) }))
  }

  /**
   * Leave edit mode. Without a change it just closes; with one it asks: save, discard or keep editing. false when the
   * user keeps editing, or saving failed.
   */
  private async leave_edit(layer: Extract<Layer, { kind: 'edit' }>): Promise<boolean> {
    if (!this.editor.changed) {
      this.close_edit(layer)
      return true
    }
    const choice = await this.ask(m.android_save_question({ name: get_name(layer.path) }), [
      { id: 'save', label: m.android_save(), primary: true },
      { id: 'discard', label: m.android_discard() },
      { id: 'keep', label: m.android_keep_editing() }
    ], 'keep')
    if (choice === 'keep') return false
    if (choice === 'discard') {
      this.close_edit(layer)
      return true
    }
    return this.save_edit(layer, false)
  }

  /**
   * Save the edit. A file changed since editing began, as by a sync, is not overwritten unless the user chooses to;
   * they may also discard the edit or keep editing. false when editing goes on.
   */
  private async save_edit(layer: Extract<Layer, { kind: 'edit' }>, overwrite: boolean): Promise<boolean> {
    /* Save in a task; on a conflict ask, and save again over the file if the user says so. */
    const workspace = this.library!.workspace
    const text = this.editor.text
    let result: 'saved' | 'changed'
    try {
      result = await workspace.run(() => workspace.save_text(layer.path, text, overwrite ? null : layer.base))
    } catch (error: unknown) {
      this.failed(m.android_save_failed({ path: layer.path, detail: error_text(error) }), error)
      return false
    }
    if (result === 'changed') {
      const choice = await this.ask(m.android_conflict({ name: get_name(layer.path) }), [
        { id: 'overwrite', label: m.android_overwrite() },
        { id: 'discard', label: m.android_discard_edit() },
        { id: 'keep', label: m.android_keep_editing(), primary: true }
      ], 'keep')
      if (choice === 'keep') return false
      if (choice === 'overwrite') return this.save_edit(layer, true)
      this.close_edit(layer)
      return true
    }
    this.toast.show(m.android_saved({ name: get_name(layer.path) }))
    this.close_edit(layer)
    return true
  }

  /** Close the editor and show what it covered, reading the file again, which may have just been saved. */
  private close_edit(layer: Extract<Layer, { kind: 'edit' }>): void {
    this.editor.close()
    this.cache.set_value('draft', undefined)
    this.remove(layer)
    void this.refresh_view()
  }

  // Settings and folder --------------------------------------------------------------------------------------------

  /** Open the settings page, closing the drawer. */
  private show_settings(): void {
    this.set_drawer(false)
    if (!this.find('settings')) this.push({ kind: 'settings' })
    this.render_settings()
    this.settings_view.show(true)
  }

  /** Draw the settings page anew with the current values, status and log. */
  private render_settings(): void {
    this.settings_view.render(this.stored, this.settings, this.root, this.scan_status, this.log_lines)
  }

  /** Close the settings page. */
  private close_settings(): void {
    this.settings_view.show(false)
    const layer = this.find('settings')
    if (layer) this.remove(layer)
  }

  /**
   * Store and apply changed settings: the reviewer's display at once, the scheduler's options with a recount, and
   * which files are notes or open in the app with a full rescan.
   */
  private async change_settings(stored: StoredSettings): Promise<void> {
    /* Store through the shell, convert, then hand the settings to the library and redraw. */
    this.stored = stored
    this.settings = app_settings(stored, name => this.log.warn(m.android_setting_invalid({ name })))
    this.config.inactive = this.settings.inactive
    try {
      await this.bridge.request('settings.set', { settings: stored })
    } catch (error: unknown) {
      this.failed(error_text(error), error)
    }
    const library = this.library
    if (!library) return
    if (library.configure(this.settings)) await this.rescan()
    else {
      await library.workspace.run(() => library.workspace.refresh())
      await this.refresh_view(this.elements.view.scrollTop)
    }
  }

  /**
   * Let the user pick the notes folder; a new folder replaces everything shown and kept for the old one. An edit with
   * changes is saved or discarded first, as the user chooses; keeping it cancels the pick.
   */
  private async pick_root(): Promise<void> {
    /* Settle an edit, ask the shell's picker, then on a new folder forget the old one's cache and state and scan. */
    const edit = this.find('edit')
    if (edit && !await this.leave_edit(edit)) return
    let root: Root | null
    try {
      root = (await this.bridge.request('root.pick', {})).root
    } catch (error: unknown) {
      this.failed(error_text(error), error)
      return
    }
    if (!root) return
    // Below the settings page only the old folder's review or links can be open; they end.
    for (const layer of [...this.layers].reverse()) if (layer.kind !== 'settings') this.remove(layer)
    this.reviewer.close()
    this.cache.clear()
    this.root = root
    this.path = null
    this.shown_text = null
    this.view.clear()
    this.matches = null
    for (const path of Object.keys(this.expanded)) delete this.expanded[path]
    this.library = this.create_library(root)
    this.render()
    this.render_settings()
    this.start_timer()
    await this.rescan()
  }

  /** A library of the notes folder, over a new storage, reporting to the app. */
  private create_library(root: Root): Library {
    const storage = new AndroidStorage(this.bridge, this.cache)
    return new Library(this.bridge, storage, this.settings, this.log, {
      refreshed: async () => {
        this.render_tree()
        this.render()
      },
      problems: count => {
        if (count) this.toast.show(m.workspace_problems_found({ count }), 6000)
      }
    }, root.name)
  }

  /**
   * Scan the folder and update the notes (see Library.scan()), keeping the listing for the next start. The status shows
   * on the settings page; failures are reported. The shown file is read again, as a scan found the folder changed.
   */
  private async rescan(): Promise<void> {
    const library = this.library
    if (!library) return
    this.set_status(m.android_scanning())
    try {
      await library.scan()
      this.cache.set_value('files', library.files)
      this.set_status(m.android_scanned({ count: library.files.length }))
    } catch (error: unknown) {
      this.set_status(error_text(error))
      const unavailable = error instanceof BridgeError && (error.code === 'denied' || error.code === 'no_root')
      this.failed(unavailable ? m.android_folder_unavailable() : m.android_scan_failed({ detail: error_text(error) }), error)
      return
    }
    this.render_tree()
    this.render()
    await this.refresh_view()
  }

  /** Show a scan's progress on the settings page. */
  private set_status(status: string): void {
    this.scan_status = status
    this.settings_view.status(status)
  }

  // Lifecycle ------------------------------------------------------------------------------------------------------

  /** Pad the fixed parts of the page by the system bars and the keyboard. */
  private apply_insets(insets: Insets): void {
    const style = document.documentElement.style
    for (const side of ['top', 'bottom', 'left', 'right'] as const) style.setProperty(`--inset-${side}`, `${insets[side]}px`)
    document.documentElement.classList.toggle('keyboard', insets.keyboard)
  }

  /** Going to the background: keep an unsaved edit as a draft, since Android may end the app; stop recounting. */
  private pause(): void {
    window.clearInterval(this.timer)
    this.timer = 0
    const layer = this.find('edit')
    if (layer && this.editor.changed) this.cache.set_value('draft', { path: layer.path, text: this.editor.text, base: layer.base })
  }

  /** Back in the foreground: recount, read the shown file again, and after a long time away rescan the folder. */
  private resume(away: number): void {
    this.start_timer()
    const library = this.library
    if (!library) return
    if (away >= RESCAN_AFTER) void this.rescan()
    else {
      void library.workspace.run(() => library.workspace.refresh())
      void this.refresh_view()
    }
  }

  /** Recount every minute while in the foreground, so due counts follow the clock. */
  private start_timer(): void {
    window.clearInterval(this.timer)
    this.timer = window.setInterval(() => {
      const workspace = this.library?.workspace
      if (workspace) void workspace.run(() => workspace.refresh())
    }, 60_000)
  }

  /** Report a failure: a message for the user and the log, which adds the error's own text when the message lacks it. */
  private failed(message: string, error: unknown): void {
    this.log.error(error instanceof Error && !message.includes(error.message) ? `${message} (${error.message})` : message)
    this.toast.show(message, 6000)
  }

  /** Keep a log line for the settings page and pass it to the console, where adb's logcat shows it. */
  private record(level: 'info' | 'warn' | 'error', message: string): void {
    const time = new Date().toTimeString().slice(0, 8)
    this.log_lines.push(`${time} ${level}: ${message}`)
    if (this.log_lines.length > LOG_LINES) this.log_lines.splice(0, this.log_lines.length - LOG_LINES)
    console[level](`srmd: ${message}`)
  }
}
