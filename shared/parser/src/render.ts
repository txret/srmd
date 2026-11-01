/**
 * markdown-it renderer rules for srmd's tokens (SYNTAX.md, "HTML"): a cloze is a span or div with class `cloze`,
 * `data-ordinal` and `data-card`; an implicit opener shows a colon; explicit markers, references, reference lines and
 * definitions show nothing. A note embedded in another is not reviewed, so its clozes have ordinal 0 and no card.
 */
import type MarkdownIt from 'markdown-it'
import type { Renderer, Token } from 'markdown-it'
import { serialize_card } from './cards'
import type { MarkerMeta } from './syntax'
import type { Cloze, SrmdEnv } from './types'

/**
 * Register the rules on a markdown-it instance.
 * @param md - The instance, changed in place.
 */
export function srmd_renderer(md: MarkdownIt): void {
  /**
   * Open a cloze element with the card ordinal and the canonical definition of its card, which keeps the in-memory
   * reference, independent of the ordinal; replacement cards in the environment take the card's place.
   */
  function open(tokens: Token[], index: number, _options: unknown, env: { srmd?: SrmdEnv } | undefined): string {
    /* An embedded note's cloze has no card; any other shows its replacement card or the one the parse found. */
    const token = tokens[index]
    const cloze = token.meta as Cloze
    // As markdown-it writes block tags: on a line of their own, also after the text of a tight list item.
    const start = token.block && tokens[index - 1]?.hidden ? '\n<' : '<'
    const end = token.block ? '>\n' : '>'
    if (env?.srmd?.embedded) return `${start}${token.tag} class="cloze" data-ordinal="0"${end}`
    const card = env?.srmd?.scheduling?.[cloze.ordinal - 1] ?? cloze.scheduling
    // Definition fields use attribute-safe characters only.
    return `${start}${token.tag} class="cloze" data-ordinal="${cloze.ordinal}" data-card="${serialize_card(card)}"${end}`
  }
  const rules: Renderer['rules'] = md.renderer.rules
  rules.srmd_cloze_open = open
  rules.srmd_cloze_close = (tokens, index) => `</${tokens[index].tag}>${tokens[index].block ? '\n' : ''}`
  rules.srmd_opener = (tokens, index) => md.utils.escapeHtml((tokens[index].meta as MarkerMeta).value ?? '')
  rules.srmd_closer = rules.srmd_reference = rules.srmd_reference_line = rules.srmd_definition = () => ''
}
