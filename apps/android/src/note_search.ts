/** The search bar of the shown file, swiped up from the bottom: matches highlighted, counted and stepped through. */
import { m } from '@srmd/l10n'
import { Search } from '@srmd/ui'
import { icons } from './icons'

/** What the bar searches: the shown file's rendered text in view mode, its source in edit mode. */
export interface SearchTarget {
  /**
   * Highlight every match of query, ignoring case, and make the next or previous one current, revealing it: from the
   * start when the query changed. Returns the current match's index and the number of matches.
   */
  find(query: string, backward: boolean): { index: number; total: number }
  /** Remove the highlights and stop following the content's layout. */
  clear(): void
}

/**
 * The view mode target: the shared Search's highlight boxes over the rendered file in content, which must be the
 * scroll container. The Search's own field and button go into a detached element; the bar drives it.
 */
export function view_target(content: HTMLElement): SearchTarget {
  const search = new Search(document.createElement('div'), content, { placeholder: '', button_lbl: '' })
  return {
    /** Search the rendered text through the Search's field: the next match, or the previous one backward. */
    find(query, backward) {
      search.field.value = query
      search.run_search(backward)
      return { index: search.index, total: search.highlights.length }
    },
    /** Remove the boxes and stop following the content's layout. */
    clear() {
      search.clear()
      search.dispose()
    }
  }
}

/** The bar: a field, the match count, previous and next, and close. Typing searches after a short pause. */
export class NoteSearch {
  /** What the open bar searches; null while it is closed. */
  private target: SearchTarget | null = null
  private readonly input: HTMLInputElement
  private readonly count: HTMLElement
  /** The pending search after typing, or 0. */
  private timer = 0

  /** Build the bar in element; on_close runs when its close button is tapped, so the app can close it as Back does. */
  constructor(readonly element: HTMLElement, on_close: () => void) {
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

  /** Whether the bar is open. */
  get open(): boolean {
    return this.target !== null
  }

  /** Open the bar on target with query, searching it at once, or with an empty field focused for typing. */
  show(target: SearchTarget, query = ''): void {
    this.target?.clear()
    this.target = target
    this.element.hidden = false
    this.input.value = query
    this.count.textContent = ''
    if (query) this.find(false)
    else this.input.focus()
  }

  /** Close the bar and its highlights. */
  hide(): void {
    clearTimeout(this.timer)
    this.target?.clear()
    this.target = null
    this.element.hidden = true
    this.input.blur()
  }

  /** Search the field's text: the next match, or the previous one backward; show which of how many it is. */
  private find(backward: boolean): void {
    if (!this.target) return
    const query = this.input.value
    const { index, total } = this.target.find(query, backward)
    this.count.textContent = !query ? '' : total ? `${index + 1}/${total}` : m.android_no_matches()
  }
}
