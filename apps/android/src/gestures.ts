/**
 * Swipes: right over the shown file opens the drawer, following the finger; left over the open drawer closes it; up
 * from the handle strip at the bottom opens the note search. Touch events, passive, so scrolling is never delayed:
 * CSS (`touch-action: pan-y`) leaves sideways movement to these handlers instead of the browser.
 */

/** Travel in CSS pixels before a touch counts as moving in a direction, so taps and jitter are not swipes. */
export const SLOP = 12

/**
 * The axis a touch moved along, once it travelled SLOP pixels: sideways ('x') only when clearly more sideways than up
 * or down, since a slanted scroll must stay a scroll; null before then.
 */
export function swipe_axis(dx: number, dy: number): 'x' | 'y' | null {
  if (Math.hypot(dx, dy) < SLOP) return null
  return Math.abs(dx) > 1.5 * Math.abs(dy) ? 'x' : 'y'
}

/**
 * Whether a drag of the drawer ends open: a fling decides by its direction, otherwise the drawer stays open when
 * more than half of it shows.
 * @param shown - How many pixels of the drawer show when the finger lifts.
 * @param velocity - The finger's last speed in pixels per millisecond, positive towards opening.
 */
export function settles_open(shown: number, width: number, velocity: number): boolean {
  if (Math.abs(velocity) > 0.5) return velocity > 0
  return shown > width / 2
}

/** Whether target lies in an element that scrolls sideways, below boundary, such as a wide table: its swipes scroll it. */
function in_sideways_scroller(target: Element | null, boundary: Element): boolean {
  for (let element = target; element && element !== boundary; element = element.parentElement) {
    if (element.scrollWidth > element.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(element).overflowX)) return true
  }
  return false
}

/** What the swipes do; the app keeps the drawer's state and its place among what is open. */
export interface GestureHandlers {
  drawer_open(): boolean
  drawer_width(): number
  /** Show shown pixels of the drawer while a finger drags it; null ends the drag. */
  drag_drawer(shown: number | null): void
  /** Open or close the drawer after a drag, or a tap on the dimmed note. */
  set_drawer(open: boolean): void
  open_search(): void
}

/** A touch being followed: where it started, and its last position and time for the fling speed. */
interface Track {
  x: number
  y: number
  last_x: number
  last_time: number
  velocity: number
  axis: 'x' | 'y' | null
  /** Whether the touch started in a sideways scroller, whose sideways moves are its own. */
  sideways: boolean
  /** Whether the touch drags the drawer. */
  dragging: boolean
}

/** Follow touches on the main view, the drawer and its scrim, and the handle strip. */
export function attach_gestures(main: HTMLElement, drawer: HTMLElement, scrim: HTMLElement, handle: HTMLElement, handlers: GestureHandlers): void {
  /*
   * 1. Opening: a touch on the main view that moves sideways to the right, outside sideways scrollers, drags the drawer
   *    open by the distance moved; lifting the finger settles it open or closed.
   * 2. Closing: the same to the left on the open drawer or its scrim, which a tap also closes.
   * 3. Searching: a touch on the handle moving up, when it lifts, or a tap on it, opens the note search.
   */
  let track: Track | null = null

  /** Start following a touch at its first point. */
  const start = (event: TouchEvent, boundary: Element): void => {
    const touch = event.touches[0]
    track = event.touches.length === 1 ? {
      x: touch.clientX, y: touch.clientY, last_x: touch.clientX, last_time: event.timeStamp, velocity: 0,
      axis: null, sideways: in_sideways_scroller(event.target as Element, boundary), dragging: false
    } : null
  }

  /** Follow a move: decide the axis once, then drag the drawer by the sideways distance while it is a drawer drag. */
  const move = (event: TouchEvent, closing: boolean): void => {
    if (!track || event.touches.length !== 1) return
    const touch = event.touches[0]
    const dx = touch.clientX - track.x
    if (track.axis === null) {
      track.axis = swipe_axis(dx, touch.clientY - track.y)
      if (track.axis === 'x' && !track.sideways && (closing ? dx < 0 : dx > 0)) track.dragging = true
    }
    if (!track.dragging) return
    const elapsed = event.timeStamp - track.last_time
    if (elapsed > 0) track.velocity = (touch.clientX - track.last_x) / elapsed
    track.last_x = touch.clientX
    track.last_time = event.timeStamp
    handlers.drag_drawer(closing ? handlers.drawer_width() + dx : dx)
  }

  /** Settle a drawer drag when the finger lifts; a cancelled touch leaves the drawer as it was. */
  const end = (event: TouchEvent, closing: boolean): void => {
    const ended = track
    track = null
    if (!ended?.dragging) return
    if (event.type === 'touchcancel') {
      handlers.drag_drawer(null)
      return
    }
    const width = handlers.drawer_width()
    const dx = ended.last_x - ended.x
    handlers.drag_drawer(null)
    handlers.set_drawer(settles_open(closing ? width + dx : dx, width, ended.velocity))
  }

  // Step 1: opening from the main view.
  const passive = { passive: true }
  main.addEventListener('touchstart', event => { if (!handlers.drawer_open()) start(event, main) }, passive)
  main.addEventListener('touchmove', event => move(event, false), passive)
  main.addEventListener('touchend', event => end(event, false), passive)
  main.addEventListener('touchcancel', event => end(event, false), passive)

  // Step 2: closing from the drawer or the dimmed note.
  for (const element of [drawer, scrim]) {
    element.addEventListener('touchstart', event => { if (handlers.drawer_open()) start(event, element) }, passive)
    element.addEventListener('touchmove', event => move(event, true), passive)
    element.addEventListener('touchend', event => end(event, true), passive)
    element.addEventListener('touchcancel', event => end(event, true), passive)
  }
  scrim.addEventListener('click', () => handlers.set_drawer(false))

  // Step 3: the handle; its moves never scroll (touch-action: none), so the swipe is its own. The search opens when the
  // finger lifts: a field focused then, during the user's activation, brings up the keyboard, unlike one focused while
  // the finger moves.
  let handle_y: number | null = null
  let swiped = false
  handle.addEventListener('touchstart', event => {
    handle_y = event.touches[0].clientY
    swiped = false
  }, passive)
  handle.addEventListener('touchmove', event => {
    if (handle_y !== null && handle_y - event.touches[0].clientY > 2 * SLOP) swiped = true
  }, passive)
  handle.addEventListener('touchend', () => {
    if (swiped) handlers.open_search()
    handle_y = null
    swiped = false
  }, passive)
  handle.addEventListener('click', () => handlers.open_search())
}
