/** Icons of the app's buttons: simple stroked shapes in the text color, sized by CSS. */

/** An inline SVG icon of path data, hidden from screen readers: the button carries the label. */
const icon = (shapes: string, filled = false): string =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${shapes}</svg>`

export const icons = {
  /** View mode: an eye. */
  eye: icon('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  /** Edit mode: the Markdown mark, M and a down arrow in a frame. */
  markdown: icon('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 15V9l3 3 3-3v6M17 9v6m-2.5-2.5L17 15l2.5-2.5"/>'),
  /** Format: lines of text, the inner ones indented. */
  format: icon('<path d="M4 6h16M9 10h11M9 14h11M4 18h16"/>'),
  /** Review: a play triangle. */
  play: icon('<path d="M8 5.5v13l10.5-6.5z"/>', true),
  /** Settings: a toothed wheel. */
  gear: icon('<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="6.5"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>'),
  close: icon('<path d="M6 6l12 12M18 6L6 18"/>'),
  up: icon('<path d="M6 15l6-6 6 6"/>'),
  down: icon('<path d="M6 9l6 6 6-6"/>'),
  /** A collapsed folder's chevron; CSS turns it down when the folder is expanded. */
  chevron: icon('<path d="M9 6l6 6-6 6"/>'),
  search: icon('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/>')
}
