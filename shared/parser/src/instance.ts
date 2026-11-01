/**
 * srmd's markdown-it plugin and instances. srmd_plugin() adds srmd to an instance: its syntax, the cloze rule and its
 * renderer rules, and with `positions` the source positions saving needs, so that an instance composed of other
 * plugins too, as VS Code's reviews compose one, parses notes that can be saved. srmd syntax applies to the parses
 * whose environment carries `env.srmd` (see applies()).
 *
 * shared_markdown_it() is srmd's own instance, which notes are loaded with: markdown-it's defaults, with HTML, and srmd
 * recording positions. It is for reading cards, so it has nothing that only changes what notes render as; the
 * hosts render with instances of their own, with Foam's syntax where Foam's plugins are.
 */
import MarkdownIt from 'markdown-it'
import { cloze_rule } from './clozes'
import { srmd_metadata } from './metadata'
import { track_positions } from './positions'
import { srmd_renderer } from './render'
import { applies, srmd_syntax } from './syntax'

/** Options of srmd_plugin(). */
export interface PluginOptions {
  /**
   * Record the source positions saving needs, and read YAML front matter and link reference definitions as blocks of
   * their own, which positions take as metadata (metadata.ts), so that the instance's parses can be saved. Positions
   * change how the instance parses (positions.ts): only for an instance of srmd's own, never for one other documents
   * are rendered with too, such as VS Code's preview's.
   */
  positions?: boolean
}

/**
 * Add srmd to a markdown-it instance: its syntax, the cloze rule right after inline parsing, before linkify and
 * typography, and its renderer rules; with `positions`, first the positions and metadata blocks saving needs.
 * @param md - The instance, changed in place.
 */
export function srmd_plugin(md: MarkdownIt, options: PluginOptions = {}): void {
  /* Positions and metadata blocks go first, so their rules precede srmd's own at the same places. */
  if (options.positions) {
    track_positions(md)
    srmd_metadata(md)
  }
  srmd_syntax(md)
  md.core.ruler.after('inline', 'srmd_clozes', state => {
    if (applies(state.env)) cloze_rule(state)
  })
  srmd_renderer(md)
}

/** srmd's own instance, created when first needed. */
let shared_md: MarkdownIt | undefined

/** srmd's own markdown-it instance (see the module comment), shared by every parse that names none. */
export function shared_markdown_it(): MarkdownIt {
  if (!shared_md) {
    shared_md = new MarkdownIt({ html: true })
    srmd_plugin(shared_md, { positions: true })
  }
  return shared_md
}
