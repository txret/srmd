/** Review mode: one card at a time in the shared reviewer controls, as in the VS Code review tab. */
import type { ReviewRating } from '@srmd/scheduler'
import { review_rating } from '@srmd/reviewer'
import { compile_html, mount, type MountedCard, type ReviewerEvent, type UIConfig } from '@srmd/ui'
import type { PreparedCard } from '@srmd/workspace'
import { folder_url } from './note_view'

/** The pane showing the card under review. */
export class ReviewView {
  /** The shown card's controls; null while no card is shown. */
  private card: MountedCard | null = null
  /** Ends the wait for the shown card's rating: with a rating, or null when the card is closed unrated. */
  private settle: ((rating: ReviewRating | null) => void) | null = null

  /**
   * Show cards in element with the display settings of config; on_search reports when the reviewer's own search
   * opens or closes, so Back can close it.
   */
  constructor(readonly element: HTMLElement, private readonly config: UIConfig, private readonly on_search: (open: boolean) => void) {}

  /**
   * Show a card and wait for its first rating; null when it is closed first. The document's base moves to the note's
   * folder before the markup goes in, so relative images load from there.
   */
  show(card: PreparedCard): Promise<ReviewRating | null> {
    /* Replace the previous card, insert this one's controls, then mount them in the same task, before any paint. */
    this.close()
    document.querySelector('base')!.href = folder_url(location.origin, card.path)
    const { data } = card
    this.element.innerHTML = compile_html('review-root', data.title, data.html, data.choices, 'good', this.config, data.notices)
    const root = this.element.firstElementChild as HTMLElement
    const promise = new Promise<ReviewRating | null>(resolve => {
      this.settle = rating => {
        this.settle = null
        resolve(rating)
      }
    })
    root.addEventListener('sr-event', (event: Event) => {
      // Only the first rating counts; later taps while the rating is saved do nothing.
      const detail = (event as CustomEvent<ReviewerEvent>).detail
      if (detail?.type === 'search') return this.on_search(detail.data)
      const rating = detail?.type === 'choice' ? review_rating(detail.data) : null
      if (rating !== null) this.settle?.(rating)
    })
    this.card = mount(root, data.card_ordinal, this.config)
    return promise
  }

  /** Close the shown card, ending its wait without a rating. */
  close(): void {
    this.card?.unmount()
    this.card = null
    this.settle?.(null)
    this.element.innerHTML = ''
  }

  /** Open the reviewer's own search of the note; false without a card. */
  open_search(): boolean {
    this.card?.search(true)
    return this.card !== null
  }

  /** Close the reviewer's search. */
  close_search(): void {
    this.card?.search(false)
  }
}
