import type { UIConfig } from './config'
import type { ReviewChoice } from '../../reviewer/src'
import { escape_html as text } from './utils'

/**
 * Build the HTML controls and note content for one review surface.
 * html is the rendered note; the title, labels, choice texts and notices are plain text and are escaped here.
 * notices are lines shown between the title and the note, such as ReviewData.notices; none shows no notice.
 */
export function compile_html(root: string, title: string, html: string, choices: ReviewChoice[], default_choice: string, config: UIConfig, notices: string[] = []): string {
  /* Format plain-text choices as buttons and notices as paragraphs, then compose the front/back review controls. */
  let choice_btns = ''
  // The previewed interval gets its own element so stylesheets can show it as a quieter second line.
  for (const {label, detail, id} of choices)
    choice_btns += `<button type="button" data-id="${id}" class="choice-btn${id === default_choice ? ' default' : ''}">${text(label)}<span class="detail">${text(detail)}</span></button>\n`

  const notice = notices.length ? `\n  <div class="notice" role="status">${notices.map(line => `<p>${text(line)}</p>`).join('')}</div>` : ''

  return `<div id="${root}" class="sr-reviewer front${config.night_mode ? ' night_mode' : ''}" tabindex="0">
  <div class="header">
    <h1 class="title">${text(title)}</h1>
  </div>${notice}
  <div class="content">${html}</div>
  <div class="footer">
    <div class="front">
      <button type="button" class="flip-btn">${text(config.labels.show_back)}</button>
      <button type="button" class="open-search-btn">${text(config.labels.open_search)}</button>
    </div>
    <div class="back">
      <button type="button" class="flip-btn">${text(config.labels.show_front)}</button>
      ${choice_btns}
      <button type="button" class="open-search-btn">${text(config.labels.open_search)}</button>
    </div>
    <div class="search"></div>
  </div>
</div>
`
}
