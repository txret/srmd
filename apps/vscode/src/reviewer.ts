import { mount as mount_ui, type ReviewerEvent, type UIConfig } from '@srmd/ui'

/** A card sent by the extension: rendered controls and note, the note's folder for relative resources, and the reviewed card's ordinal. */
export interface CardMessage {
  type: 'card'
  /** Identifies the card in its rating, so a late rating for a skipped card is ignored. */
  id: number
  base: string
  markup: string
  ordinal: number
}

/** Messages to the extension: the document listens for cards, or the first rating chosen for a card. */
export type ReviewerMessage = { type: 'ready' } | { type: 'review'; id: number; choice_id: string }

/** VS Code supplies this function inside each webview document. */
declare function acquireVsCodeApi(): { postMessage(message: ReviewerMessage): void }

/** Show every card the extension sends in container, forwarding the first rating chosen for each. */
function start(container: HTMLElement, config: UIConfig): void {
  /* Acquire the host bridge once, listen for cards, then report that cards can be sent. */
  const vscode = acquireVsCodeApi()
  /** Release the shown card's observers before the next card replaces it. */
  let unmount: (() => void) | undefined

  /** Replace the previous card with this one and connect its choices to the extension. */
  function show(card: CardMessage): void {
    /* Point relative resources at the note's folder, insert a fresh root, then mount the shared controls. */
    // The base applies to URLs resolved while the markup is inserted.
    document.querySelector('base')!.href = card.base
    // A new root element per card discards the previous card's listeners along with it; observers need releasing.
    unmount?.()
    container.innerHTML = card.markup
    const root = container.firstElementChild as HTMLElement
    /** Ignore repeated clicks/shortcuts while the extension saves and sends the next card. */
    let submitted = false
    root.addEventListener('sr-event', (event: Event): void => {
      /* Forward only the first rating choice; other UI events do not change scheduling. */
      const detail = (event as CustomEvent<ReviewerEvent>).detail
      if (submitted || detail?.type !== 'choice' || typeof detail.data !== 'string') return
      submitted = true
      vscode.postMessage({ type: 'review', id: card.id, choice_id: detail.data })
    })
    // Mounting in the task that inserted the markup hides the clozes before the browser can paint the card.
    unmount = mount_ui(root, card.ordinal, config)
  }

  window.addEventListener('message', (event: MessageEvent<CardMessage>) => {
    if (event.data?.type === 'card') show(event.data)
  })
  // Messages sent before this listener existed are lost, so the extension sends cards only after this.
  vscode.postMessage({ type: 'ready' })
}

// The extension places its display settings on the container of an otherwise static document.
const container = document.getElementById('review')
if (container) start(container, JSON.parse(container.dataset.config!))
