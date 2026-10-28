/** The drawer's file tree: every file of the notes folder, notes and folders with their counts. */
import { m } from '@srmd/l10n'
import { escape_html } from '@srmd/ui'
import type { TreeRow } from '@srmd/workspace'
import { icons } from './icons'

/** What tapping a row does. */
export interface TreeHandlers {
  /** A file's row: open it. */
  open(path: string): void
  /** A folder's row: expand or collapse it. */
  toggle(path: string): void
  /** A row's Review button: review the note or folder. */
  review(path: string): void
}

/** The HTML of one row: indentation by depth, a chevron for folders, the name, counts and, with cards to do, Review. */
export function row_html(row: TreeRow, selected: boolean): string {
  /* Classes carry the kind, expansion and selection for CSS; data-path identifies the row to the click handler. */
  const folder = row.kind === 'folder'
  const classes = ['row', row.kind, row.expanded ? 'expanded' : '', selected ? 'selected' : ''].filter(Boolean).join(' ')
  const twist = folder ? `<span class="twist">${icons.chevron}</span>` : '<span class="twist"></span>'
  const warning = row.problems ? '⚠ ' : ''
  const counts = row.counts ? `<span class="counts">${escape_html(warning + m.android_counts(row.counts))}</span>` : ''
  const matches = row.matches ? `<span class="matches">${row.matches}</span>` : ''
  const due = row.counts ? row.counts.due + row.counts.new : 0
  const review = due ? `<button type="button" class="review" aria-label="${escape_html(m.android_review_scope({ name: row.name }))}">${icons.play}</button>` : ''
  const expanded = folder ? ` aria-expanded="${row.expanded}"` : ''
  return `<div class="${classes}" role="treeitem"${expanded} data-path="${escape_html(row.path)}" style="--depth: ${row.depth}">` +
    `${twist}<span class="name">${escape_html(row.name)}</span>${matches}${counts}${review}</div>`
}

/** The tree's rows in an element, with taps delegated to the handlers. */
export class TreeView {
  /** Listen for taps on element's rows. */
  constructor(readonly element: HTMLElement, handlers: TreeHandlers) {
    element.addEventListener('click', event => {
      /* A Review button acts on its row; otherwise the row opens its file or toggles its folder. */
      const target = event.target as HTMLElement
      const row = target.closest<HTMLElement>('.row')
      if (!row) return
      const path = row.dataset.path!
      if (target.closest('.review')) handlers.review(path)
      else if (row.classList.contains('folder')) {
        // The workspace folder always shows its children.
        if (path) handlers.toggle(path)
      } else handlers.open(path)
    })
  }

  /** Show rows, marking the row of the selected path. */
  render(rows: TreeRow[], selected: string | null): void {
    this.element.innerHTML = rows.map(row => row_html(row, row.path === selected)).join('')
  }

  /** Scroll the selected row into view, as when the drawer opens. */
  reveal_selected(): void {
    this.element.querySelector('.row.selected')?.scrollIntoView({ block: 'nearest' })
  }
}
