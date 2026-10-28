/** Questions with a few answers, such as whether to save an edit, and short messages that disappear by themselves. */
import { escape_html } from '@srmd/ui'

/** An answer to a question: its id, which ask() resolves with, and its button label. */
export interface Choice {
  id: string
  label: string
  /** The suggested answer, styled as the primary button. */
  primary?: boolean
}

/** One question at a time, modal over the app. */
export class Dialog {
  /** Ends the open question with an answer; null while none is open. */
  private settle: ((id: string) => void) | null = null

  /** Ask in element, an overlay hidden while no question is open. */
  constructor(readonly element: HTMLElement) {
    element.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLElement>('button[data-id]')
      if (button) this.answer(button.dataset.id!)
    })
  }

  /** Whether a question is open. */
  get open(): boolean {
    return this.settle !== null
  }

  /** Ask a question; resolves with the chosen answer's id. A question still open is answered with its last choice. */
  ask(message: string, choices: Choice[]): Promise<string> {
    /* Close any open question, render the message and buttons, then wait for an answer. */
    const last = this.element.querySelector<HTMLElement>('button[data-id]:last-of-type')
    if (this.settle && last) this.answer(last.dataset.id!)
    const buttons = choices.map(choice =>
      `<button type="button" data-id="${escape_html(choice.id)}"${choice.primary ? ' class="primary"' : ''}>${escape_html(choice.label)}</button>`).join('')
    this.element.innerHTML = `<div class="box" role="alertdialog" aria-modal="true"><p>${escape_html(message)}</p><div class="choices">${buttons}</div></div>`
    this.element.hidden = false
    this.element.querySelector<HTMLElement>('button.primary')?.focus()
    return new Promise(resolve => {
      this.settle = id => {
        this.settle = null
        this.element.hidden = true
        this.element.innerHTML = ''
        resolve(id)
      }
    })
  }

  /** Answer the open question with id, as its button or Back does. */
  answer(id: string): void {
    this.settle?.(id)
  }
}

/** A message at the bottom of the screen for a few seconds, such as a saved note or a failure. */
export class Toast {
  /** The pending hide, or 0. */
  private timer = 0

  /** Show messages in element. */
  constructor(readonly element: HTMLElement) {}

  /** Show a message, replacing the previous one, for ms milliseconds. */
  show(message: string, ms = 4000): void {
    this.element.textContent = message
    this.element.classList.add('shown')
    clearTimeout(this.timer)
    this.timer = window.setTimeout(() => this.element.classList.remove('shown'), ms)
  }
}
