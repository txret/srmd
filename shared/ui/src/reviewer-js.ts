import type { UIConfig } from './config'
import { Search } from './search'
import { shortcut_matches } from './utils'

/** A rating chosen in the reviewer, dispatched on its root as the `sr-event` custom event. */
export type ReviewerEvent = {
  type: 'choice'
  /** Identifier of the chosen rating, as on its button's data-id. */
  data: string
}

/**
 * Scroll content to the context of first, the card's first active cloze, by these priorities:
 * 1. the last horizontal rule before it;
 * 2. for an active cloze nested in other groups, the first cloze of its outermost ancestor's group;
 * 3. the end of the last cloze before it, at the first visible character that follows;
 * 4. otherwise the top of the note.
 */
function scroll_to_prompt(content: HTMLElement, first: HTMLElement): void {
  /* Collect rules and clozes before first in document order, then apply the first rule that has a target. */
  const start = { behavior: 'auto', block: 'start', inline: 'nearest' } as const
  const marks = Array.from(content.querySelectorAll<HTMLElement>('hr, .cloze'))
  const before = marks.slice(0, marks.indexOf(first))

  const rule = before.filter(mark => mark.tagName === 'HR').at(-1)
  if (rule) return rule.scrollIntoView(start)

  // Ancestors precede their descendants, so the first cloze containing first is the outermost ancestor.
  const outermost = before.find(mark => mark.contains(first))
  if (outermost) {
    content.querySelector<HTMLElement>(`.cloze[data-ordinal="${outermost.dataset.ordinal}"]`)!.scrollIntoView(start)
    return
  }

  // The last cloze before first that is not nested in an earlier one; its end is where this prompt starts.
  let boundary: HTMLElement | undefined
  for (const mark of before) if (!boundary?.contains(mark)) boundary = mark
  if (!boundary) {
    content.scrollTop = 0
    return
  }
  const prompt = document.createRange()
  prompt.setStartAfter(boundary)
  prompt.setEndBefore(first)
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    const offset = (text.textContent ?? '').search(/\S/)
    if (offset < 0 || !prompt.intersectsNode(text)) continue
    const line = document.createRange()
    line.setStart(text, offset)
    line.setEnd(text, offset + 1)
    content.scrollTop += line.getBoundingClientRect().top - content.getBoundingClientRect().top - content.clientTop
    return
  }
  first.scrollIntoView(start)
}

/**
 * Make the markup from compile_html() interactive for the card with this ordinal, marking its clozes `active`.
 * Call it in the same task that inserts the markup: the browser paints only between tasks, so no cloze shows
 * before it is hidden. Ratings are dispatched on root as `sr-event` custom events carrying a ReviewerEvent.
 * @returns Unmount: call it before the card is replaced, to stop observing its layout.
 */
export function mount(root: HTMLElement, ordinal: number, config: UIConfig): () => void {
  /*
   * 1. Mark the card's clozes `active` and hide the clozes for the front face: the active group always, inactive
   *    groups unless configured visible.
   * 2. Handle clicks: rating and flip buttons, search, the title (reveal or hide all), the content's edges
   *    (previous/next active cloze) and clozes themselves (reveal or hide one).
   * 3. Handle the configured keyboard shortcuts, then focus the root and scroll to the first prompt.
   */
  /** Report a chosen rating to the host. */
  const choose = (choice_id: string): void => {
    root.dispatchEvent(new CustomEvent<ReviewerEvent>('sr-event', { detail: { type: 'choice', data: choice_id } }))
  }

  const content = root.querySelector('.content') as HTMLElement
  const search = root.querySelector('.search') as HTMLDivElement
  const searcher = new Search(search, content, { placeholder: config.labels.search_hint, button_lbl: config.labels.do_search })
  const shortcuts = config.shortcuts

  // Inline clozes are spans and block clozes divs.
  const clozes = Array.from(content.querySelectorAll('.cloze')) as HTMLElement[]
  /** The active group's clozes in document order; the current one is revealed by stepping through them. */
  const active_clozes: HTMLElement[] = []
  for (const cloze of clozes) {
    if (Number(cloze.dataset.ordinal) === ordinal) {
      cloze.classList.add('active', 'hide')
      active_clozes.push(cloze)
    } else if (!config.inactive.front) {
      cloze.classList.add('hide')
    }
  }
  if (active_clozes.length) active_clozes[0].classList.add('current')

  /** Scroll a cloze to the middle of the content. */
  const scroll_to = (target: HTMLElement): void => {
    target.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' })
  }

  /** Show the front or back face, or the other face when front is omitted; hidden clozes follow the face. */
  const flip = (front: boolean = root.classList.contains('back')): void => {
    /* Swap the face classes, re-hide every cloze for that face, then reset the current cloze and leave search. */
    root.classList.toggle('front', front)
    root.classList.toggle('back', !front)
    for (const cloze of clozes) {
      const hidden = cloze.classList.contains('active') ? front : !config.inactive[front ? 'front' : 'back']
      cloze.classList.toggle('hide', hidden)
      cloze.classList.remove('current')
    }
    if (active_clozes.length) active_clozes[0].classList.add('current')
    else if (clozes.length) clozes[0].classList.add('current')
    root.classList.remove('search')
  }

  /** Reveal every cloze while any is hidden, otherwise hide them all. */
  const toggle_all = (): void => {
    const show = clozes.some(cloze => cloze.classList.contains('hide'))
    for (const cloze of clozes) cloze.classList.toggle('hide', !show)
  }

  /** Reveal the next or previous active cloze, hiding the current one; a hidden current cloze is revealed first. */
  const step = (forward: boolean): void => {
    /* Choose the target index, wrapping at either end, then reveal and scroll to it. */
    if (!active_clozes.length) return
    let next = 0
    const current = content.querySelector('.cloze.current') as HTMLElement | null
    if (current) {
      const last = active_clozes.length - 1
      const index = active_clozes.indexOf(current)
      if (current.classList.contains('hide')) next = index
      else {
        current.classList.remove('current')
        current.classList.add('hide')
        if (forward) next = index < last ? index + 1 : 0
        else next = index > 0 ? index - 1 : last
      }
    }
    active_clozes[next].classList.add('current')
    active_clozes[next].classList.remove('hide')
    scroll_to(active_clozes[next])
  }

  root.addEventListener('click', event => {
    /* Search swallows a click outside its box; then buttons, the title, the content's edges and clozes act in turn. */
    const target = event.target as HTMLElement
    if (root.classList.contains('search') && !target.closest('.footer .search')) {
      root.classList.remove('search')
      return
    }
    // A click on a button's inner text, such as a choice's interval, belongs to that button.
    const button = target.closest<HTMLElement>('button')
    if (button?.classList.contains('flip-btn')) return flip()
    if (button?.classList.contains('open-search-btn')) {
      root.classList.add('search')
      searcher.focus()
      return
    }
    if (button?.classList.contains('choice-btn')) return choose(button.dataset.id!)
    if (target.classList.contains('title')) return toggle_all()
    if (!content.contains(target)) return

    // A click within 30 px of the content's left or right edge steps through the active clozes.
    const rect = content.getBoundingClientRect()
    if (event.clientX <= rect.left + 30) return step(false)
    if (event.clientX >= rect.right - 30) return step(true)

    const cloze = target.closest<HTMLElement>('.cloze')
    if (!cloze) return
    // A click that ends a text selection reveals nothing new; otherwise an active cloze becomes current.
    if (cloze.classList.contains('active') && !document.getSelection()?.toString()) {
      content.querySelector('.cloze.current')?.classList.remove('current')
      cloze.classList.add('current')
      scroll_to(cloze)
    }
    cloze.classList.toggle('hide')
  })

  root.addEventListener('keydown', event => {
    /* Escape leaves search; the configured shortcuts act and consume their key; other keys pass through. */
    // Space and Enter activate a focused button natively: a focused Hard stays Hard rather than the default.
    if ((event.key === ' ' || event.key === 'Enter') && (event.target as HTMLElement).closest('button')) return
    if (shortcut_matches(event, 'escape') && root.classList.contains('search')) {
      root.classList.remove('search')
      event.stopImmediatePropagation()
      event.preventDefault()
      return
    }

    if (shortcuts.next && shortcut_matches(event, shortcuts.next)) {
      step(true)
    } else if (shortcuts.previous && shortcut_matches(event, shortcuts.previous)) {
      step(false)
    } else if (shortcuts.default && shortcut_matches(event, shortcuts.default)) {
      // The default key reveals the back, then chooses the default rating. A held key repeats its keydown;
      // acting on repeats would flip and rate card after card, so only a fresh press acts. Repeats are
      // still consumed below, so a held Space does not scroll the note either.
      if (!event.repeat) {
        if (root.classList.contains('back')) choose((root.querySelector('.choice-btn.default') as HTMLElement).dataset.id!)
        else flip()
      }
    } else if (shortcuts.back && shortcut_matches(event, shortcuts.back) && root.classList.contains('back')) {
      if (!event.repeat) flip(true)
    } else if (shortcuts.search && shortcut_matches(event, shortcuts.search)) {
      if (!root.classList.contains('search')) {
        root.classList.add('search')
        searcher.focus()
      } else {
        root.classList.remove('search')
      }
    } else {
      return
    }
    event.stopPropagation()
    event.preventDefault()
  })

  /** Focus the root for keyboard shortcuts and scroll to the prompt once the root is in the document. */
  const focus_once = (): void => {
    if (!root.isConnected) {
      requestAnimationFrame(focus_once)
      return
    }
    root.focus()
    if (active_clozes[0]) scroll_to_prompt(content, active_clozes[0])
  }
  focus_once()
  return () => searcher.dispose()
}
