import { m } from '../../l10n/src'

/** Button and search texts of HTML review surfaces, in the user's language. */
export interface UILabels {
  show_back: string
  show_front: string
  open_search: string
  search_hint: string
  do_search: string
}

/** Every label of the HTML review controls, in the language selected with set_language(). */
export function ui_labels(): UILabels {
  return {
    show_back: m.ui_show_back(), show_front: m.ui_show_front(), open_search: m.ui_open_search(),
    search_hint: m.ui_search_hint(), do_search: m.ui_do_search()
  }
}

/** Display and interaction settings for HTML-based review surfaces. */
export class UIConfig {
  shortcuts = {
    next: 'PageDown', previous: 'PageUp', default: ' ', back: 'Backspace', search: 'ctrl+f'
  }
  /** Declared between the other settings to keep their order in the configuration JSON sent to webviews. */
  labels: UILabels
  /** Whether inactive clozes remain visible on each face of the active card. */
  inactive = { front: false, back: false }
  /** Use the stylesheet's dark palette; hosts with their own theme variables leave it off. */
  night_mode = false

  /** Use labels created with ui_labels() by the host, so webviews need no messages of their own. */
  constructor(labels: UILabels) {
    this.labels = labels
  }
}
