import { escape_html } from './utils'

/** Translated texts of the search field and its button. */
export type SearchOptions = {
  placeholder: string
  button_lbl: string
}

/** Escape regular-expression syntax so the searched text matches literally. */
const literal = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Search box with in-document highlight boxes.
 * Matches are found in the content's text and drawn as absolutely positioned boxes over each line fragment,
 * so the note's own DOM never changes. Credit Julien Grégoire:
 * https://stackoverflow.com/questions/58553501/how-to-highlight-search-text-from-string-of-html-content-without-breaking
 */
export class Search {
  /** Element whose text is searched; the highlight boxes are appended to it. */
  content: HTMLElement
  field: HTMLInputElement
  button: HTMLElement
  /** Text the current highlights belong to; searching it again moves to the next match. */
  search_value = ''
  /** Highlight boxes of each match in document order; a match across lines has one box per fragment. */
  highlights: HTMLElement[][] = []
  /** Position of the current match in highlights, or -1 before the first. */
  index = -1
  /** Redraws the boxes when the content reflows; disconnected by dispose(). */
  private observer: ResizeObserver
  /** Animation frame of the pending redraw, or 0; a burst of resize notifications redraws once. */
  private frame = 0

  /** Build the field and button in container; Enter or the button searches content. */
  constructor(container: HTMLElement, content: HTMLElement, options: SearchOptions) {
    /* Create the controls, then keep typed keys from reaching the reviewer's shortcuts, except Escape, which closes the search. */
    container.innerHTML = `
    <input type="text" class="search-field" placeholder="${escape_html(options.placeholder)}"/>
    <button type="button" class="search-btn" tabindex="0">${escape_html(options.button_lbl)}</button>`
    this.field = container.querySelector('.search-field') as HTMLInputElement
    this.button = container.querySelector('.search-btn') as HTMLButtonElement
    this.content = content

    this.field.addEventListener('keydown', event => {
      if (event.key === 'Escape') return
      if (event.key === 'Enter') {
        this.run_search()
        this.field.focus()
      }
      event.stopPropagation()
    })
    this.button.addEventListener('click', () => this.run_search())
    this.field.addEventListener('focus', () => this.field.select())
    // Boxes are placed in pixels, so draw them again for the same search whenever the text moves: when the
    // content box resizes, and when a block inside it does without resizing the box, as when an image loads
    // or hidden clozes change size as search mode opens and closes. The note's blocks are fixed once mounted.
    this.observer = new ResizeObserver(() => this.schedule_redraw())
    this.observer.observe(content)
    for (const block of Array.from(content.children)) this.observer.observe(block)
  }

  /** Stop observing the content's layout and drop a pending redraw, before its card is replaced. */
  dispose(): void {
    /* After this, neither a resize nor an already requested frame draws boxes for the replaced card. */
    this.observer.disconnect()
    cancelAnimationFrame(this.frame)
    this.frame = 0
  }

  /**
   * Redraw in the next frame. Redrawing within the notification could change observed sizes again, such as a
   * scrollbar appearing, which browsers report as a ResizeObserver loop error.
   */
  private schedule_redraw(): void {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.redraw()
    })
  }

  /** Draw the current search's boxes again, keeping the current match. */
  redraw(): void {
    /* Remove the old boxes, highlight the same text anew, then mark the current match again. */
    if (!this.highlights.length) return
    for (const boxes of this.highlights) for (const box of boxes) box.remove()
    this.highlights = []
    this.highlight(new RegExp(literal(this.search_value), 'gi'))
    for (const box of this.highlights[this.index] ?? []) box.classList.replace('matches', 'match')
  }

  /** Remove every highlight box and forget the searched text. */
  clear(): void {
    for (const boxes of this.highlights) for (const box of boxes) box.remove()
    this.highlights = []
    this.index = -1
    this.search_value = ''
  }

  /** Move keyboard focus to the search field. */
  focus(): void {
    this.field.focus()
  }

  /**
   * Search the field's text, or move to the next match when it is unchanged; the last match wraps to the first.
   * Backward moves to the previous match instead, the first wrapping to the last; a new search backward starts at
   * the last match.
   */
  run_search(backward = false): void {
    /* Clear for empty input, highlight anew for changed input, then mark and reveal the next or previous match. */
    const value = this.field.value
    if (!value) {
      this.clear()
      return
    }
    if (value !== this.search_value) {
      this.clear()
      this.search_value = value
      this.highlight(new RegExp(literal(value), 'gi'))
    }
    if (!this.highlights.length) return
    if (this.index >= 0) for (const box of this.highlights[this.index]) box.classList.replace('match', 'matches')
    const count = this.highlights.length
    this.index = backward ? (this.index <= 0 ? count - 1 : this.index - 1) : (this.index + 1) % count
    const current = this.highlights[this.index]
    for (const box of current) box.classList.replace('matches', 'match')
    current[0].scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' })
  }

  /** Draw a box over every line fragment of every match of pattern, a global regular expression. */
  highlight(pattern: RegExp): void {
    /*
     * 1. Collect the content's text nodes once, each with its start offset in the combined text.
     * 2. Matches come in text order, so the first node a match can overlap only moves forward.
     * 3. Box each overlapped fragment's client rectangles, positioned in the content's scrolled coordinates.
     */
    const nodes: { node: Text; start: number }[] = []
    let text = ''
    const walker = document.createTreeWalker(this.content, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      nodes.push({ node, start: text.length })
      text += node.data
    }

    const bounds = this.content.getBoundingClientRect()
    const top = bounds.top + this.content.clientTop - this.content.scrollTop
    const left = bounds.left + this.content.clientLeft - this.content.scrollLeft
    let first = 0
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0
      const end = start + match[0].length
      while (nodes[first].start + nodes[first].node.length <= start) first++
      const boxes: HTMLElement[] = []
      for (let i = first; i < nodes.length && nodes[i].start < end; i++) {
        const { node, start: offset } = nodes[i]
        const range = document.createRange()
        range.setStart(node, Math.max(0, start - offset))
        range.setEnd(node, Math.min(node.length, end - offset))
        for (const rect of Array.from(range.getClientRects())) {
          const box = document.createElement('div')
          box.classList.add('matches')
          box.style.top = `${rect.top - top}px`
          box.style.left = `${rect.left - left}px`
          box.style.height = `${rect.height}px`
          box.style.width = `${rect.width}px`
          this.content.appendChild(box)
          boxes.push(box)
        }
      }
      if (boxes.length) this.highlights.push(boxes)
    }
  }
}
