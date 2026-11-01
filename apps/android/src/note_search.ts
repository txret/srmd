/**
 * The search bar of the file shown in view mode, swiped up from the bottom: matches highlighted, counted and stepped
 * through, with the shared Search's highlight boxes over the rendered file. The Search's own field and button go into a
 * detached element; the bar drives it. Edit mode searches with CodeMirror's own panel instead (editor.ts).
 */
import { m } from '@srmd/l10n'
import { Search } from '@srmd/ui'
import { icons } from './icons'

/** The bar: a field, the match count, previous and next, and close. Typing searches after a short pause. */
export class NoteSearch {
  /** The search of the rendered file while the bar is open; null while it is closed. */
  private search: Search | null = null
  private readonly input: HTMLInputElement
  private readonly count: HTMLElement
  /** The pending search after typing, or 0. */
  private timer = 0

  /**
   * Build the bar in element, for the rendered file in content, which must be the scroll container; on_close runs when
   * its close button is tapped, so the app can close it as Back does.
   */
  constructor(readonly element: HTMLElement, private readonly content: HTMLElement, on_close: () => void) {
    /* Create the controls, then connect typing, Enter and the buttons. */
    element.innerHTML = `<input type="search" enterkeyhint="search" autocomplete="off" placeholder="${m.android_search_note()}" aria-label="${m.android_search_note()}">` +
      '<span class="count" aria-live="polite"></span>' +
      `<button type="button" class="previous" aria-label="${m.android_previous_match()}">${icons.up}</button>` +
      `<button type="button" class="next" aria-label="${m.android_next_match()}">${icons.down}</button>` +
      `<button type="button" class="close" aria-label="${m.android_close()}">${icons.close}</button>`
    this.input = element.querySelector('input')!
    this.count = element.querySelector('.count')!
    this.input.addEventListener('input', () => {
      clearTimeout(this.timer)
      this.timer = window.setTimeout(() => this.find(false), 250)
    })
    this.input.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return
      event.preventDefault()
      clearTimeout(this.timer)
      this.find(event.shiftKey)
    })
    element.querySelector('.previous')!.addEventListener('click', () => this.find(true))
    element.querySelector('.next')!.addEventListener('click', () => this.find(false))
    element.querySelector('.close')!.addEventListener('click', on_close)
  }

  /** Open the bar with query, searching it at once, or with an empty field focused for typing. */
  show(query = ''): void {
    this.hide()
    this.search = new Search(document.createElement('div'), this.content, { placeholder: '', button_lbl: '' })
    this.element.hidden = false
    this.input.value = query
    this.count.textContent = ''
    if (query) this.find(false)
    else this.input.focus()
  }

  /** Close the bar, removing its highlights and no longer following the file's layout. */
  hide(): void {
    clearTimeout(this.timer)
    this.search?.clear()
    this.search?.dispose()
    this.search = null
    this.element.hidden = true
    this.input.blur()
  }

  /** Search the field's text: the next match, or the previous one backward; show which of how many it is. */
  private find(backward: boolean): void {
    if (!this.search) return
    const query = this.input.value
    this.search.field.value = query
    this.search.run_search(backward)
    const total = this.search.highlights.length
    this.count.textContent = !query ? '' : total ? `${this.search.index + 1}/${total}` : m.android_no_matches()
  }
}
