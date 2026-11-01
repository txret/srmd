/** The settings page: the notes folder, which files are notes and open in the app, review options, Rescan now, log. */
import { m } from '@srmd/l10n'
import { escape_html } from '@srmd/ui'
import type { Root } from './bridge'
import { icons } from './icons'
import { parse_list, type AppSettings, type StoredSettings } from './settings'

/** What the page's controls do. */
export interface SettingsHandlers {
  /** Choose the notes folder with the system picker. */
  pick_root(): void
  rescan(): void
  /** Store and apply changed settings. */
  change(stored: StoredSettings): void
  /** Close the page, as Back does. */
  close(): void
}

/** The queues in each order the scheduler accepts: every permutation of the three. */
const orders: string[][] = [
  ['intraday', 'interday', 'new'], ['intraday', 'new', 'interday'], ['interday', 'intraday', 'new'],
  ['interday', 'new', 'intraday'], ['new', 'intraday', 'interday'], ['new', 'interday', 'intraday']
]

/** A queue's name in the user's language. */
function queue_name(queue: string): string {
  return queue === 'intraday' ? m.android_queue_intraday() : queue === 'interday' ? m.android_queue_interday() : m.android_queue_new()
}

/** A rollover in milliseconds after midnight as `hh:mm`. */
function time_text(rollover: number): string {
  const minutes = Math.round(rollover / 60000)
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/**
 * The page. Each control stores its setting as soon as it changes, when valid; an invalid value is marked and kept out
 * of the settings until corrected.
 */
export class SettingsView {
  /** The stored settings the controls change. */
  private stored: StoredSettings = {}

  /** Build the page in element, a full-screen panel hidden while closed. */
  constructor(readonly element: HTMLElement, private readonly handlers: SettingsHandlers) {
    element.addEventListener('click', event => {
      /* Buttons act by their data-action. */
      const action = (event.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action
      if (action === 'pick') handlers.pick_root()
      else if (action === 'rescan') handlers.rescan()
      else if (action === 'close') handlers.close()
    })
    element.addEventListener('change', event => this.changed(event.target as HTMLInputElement | HTMLSelectElement))
  }

  /** Show the settings in effect and the stored ones the controls change, with the folder, a status line and the log. */
  render(stored: StoredSettings, settings: AppSettings, root: Root | null, status: string, log: string[]): void {
    /* Fill every control from the settings in effect, so defaults show too. */
    this.stored = { ...stored }
    const text = (name: string, label: string, value: string, hint: string): string =>
      `<label class="field"><span class="label">${escape_html(label)}</span>` +
      `<input type="text" name="${name}" value="${escape_html(value)}" autocapitalize="off" autocomplete="off" spellcheck="false">` +
      `<span class="hint">${escape_html(hint)}</span></label>`
    const check = (name: string, label: string, checked: boolean): string =>
      `<label class="check"><input type="checkbox" name="${name}"${checked ? ' checked' : ''}><span>${escape_html(label)}</span></label>`
    const current_order = settings.scheduler.queue_order.join()
    const options = orders.map(order =>
      `<option value="${order.join()}"${order.join() === current_order ? ' selected' : ''}>${escape_html(order.map(queue_name).join(' → '))}</option>`).join('')
    this.element.innerHTML = `
<header class="bar"><h1>${escape_html(m.android_settings())}</h1><button type="button" data-action="close" aria-label="${escape_html(m.android_close())}">${icons.close}</button></header>
<div class="page">
  <section>
    <h2>${escape_html(m.android_notes_folder())}</h2>
    <p class="root">${escape_html(root ? root.name : m.android_no_folder())}</p>
    <button type="button" class="primary" data-action="pick">${escape_html(m.android_choose_folder())}</button>
    <button type="button" data-action="rescan"${root ? '' : ' disabled'}>${escape_html(m.android_rescan())}</button>
    <p class="status" aria-live="polite">${escape_html(status)}</p>
  </section>
  <section>
    <h2>${escape_html(m.android_files())}</h2>
    ${text('suffixes', m.android_suffixes(), settings.suffixes.join(', '), m.android_suffixes_hint())}
    ${text('markdown', m.android_markdown_types(), settings.types.markdown.join(', '), m.android_types_hint())}
    ${text('text', m.android_text_types(), settings.types.text.join(', '), m.android_types_hint())}
    ${text('skip', m.android_skip(), settings.skip.join(', '), m.android_skip_hint())}
  </section>
  <section>
    <h2>${escape_html(m.android_review())}</h2>
    <label class="field"><span class="label">${escape_html(m.android_rollover())}</span><input type="time" name="rollover" value="${time_text(settings.scheduler.rollover)}"></label>
    <label class="field"><span class="label">${escape_html(m.android_queue_order())}</span><select name="queueOrder">${options}</select></label>
    ${check('inactive.front', m.android_inactive_front(), settings.inactive.front)}
    ${check('inactive.back', m.android_inactive_back(), settings.inactive.back)}
  </section>
  <section>
    <details><summary>${escape_html(m.android_log())}</summary><pre class="log">${escape_html(log.join('\n'))}</pre></details>
  </section>
</div>`
  }

  /** Show or hide the page. */
  show(open: boolean): void {
    this.element.hidden = !open
    if (open) this.element.scrollTop = 0
  }

  /** Update the status line, such as a scan's progress. */
  status(text: string): void {
    const line = this.element.querySelector('.status')
    if (line) line.textContent = text
  }

  /** Store a control's new value when valid, marking the control invalid otherwise. */
  private changed(control: HTMLInputElement | HTMLSelectElement): void {
    /* Convert by control: lists, time, queue order and flags; empty lists are invalid where a default would surprise. */
    const name = control.name
    const value = control.value
    const stored = this.stored
    let valid = true
    if (name === 'suffixes' || name === 'skip') {
      const list = parse_list(value, 'names')
      valid = name === 'skip' || list.length > 0
      if (valid) stored[name] = list
    } else if (name === 'markdown' || name === 'text') {
      stored[name] = parse_list(value, 'extensions')
    } else if (name === 'rollover') {
      valid = /^\d\d:\d\d$/.test(value)
      if (valid) stored.rollover = value
    } else if (name === 'queueOrder') {
      stored.queueOrder = value.split(',')
    } else if (name === 'inactive.front' || name === 'inactive.back') {
      stored[name] = (control as HTMLInputElement).checked
    } else return
    control.classList.toggle('invalid', !valid)
    control.setAttribute('aria-invalid', String(!valid))
    if (valid) this.handlers.change({ ...stored })
  }
}
