/** The drawer's position: slid out over the dimmed note, hidden to the left, or following a finger. */

/** The drawer panel and the scrim dimming the note behind it. */
export class Drawer {
  /** Slide element, the panel, over the note, dimming it with scrim. */
  constructor(readonly element: HTMLElement, readonly scrim: HTMLElement) {}

  /** Whether the drawer is out. */
  get open(): boolean {
    return this.element.classList.contains('open')
  }

  /** Slide the drawer out or back, animated by CSS. */
  set open(open: boolean) {
    this.drag(null)
    this.element.classList.toggle('open', open)
    this.scrim.classList.toggle('shown', open)
    this.element.setAttribute('aria-hidden', String(!open))
  }

  /** The panel's width in CSS pixels. */
  get width(): number {
    return this.element.offsetWidth
  }

  /** Show shown pixels of the drawer while a finger drags it, without animation; null hands it back to CSS. */
  drag(shown: number | null): void {
    /* Place the panel and set the scrim's opacity in proportion, then mark both as dragged so CSS stops animating them. */
    const dragging = shown !== null
    this.element.classList.toggle('dragging', dragging)
    this.scrim.classList.toggle('dragging', dragging)
    if (!dragging) {
      this.element.style.transform = ''
      this.scrim.style.opacity = ''
      return
    }
    const width = this.width
    const clamped = Math.min(Math.max(shown, 0), width)
    this.element.style.transform = `translateX(${clamped - width}px)`
    this.scrim.style.opacity = String(width ? clamped / width : 0)
  }
}
