/**
 * The types of what the app uses of Foam's preview pipeline (foam_preview.ts), as Foam's foam-markdown-it.ts declares
 * them. srmd's TypeScript settings are stricter than Foam's, so it reads these rather than Foam's sources.
 */
import type MarkdownIt from 'markdown-it'
import type { FoamWorkspace, Resource, ResourceParser } from '@foam/core'

/** How a resolved wiki link renders: with its href, or as plain text without one. */
export interface ResolvedLinkRendering {
  href?: string | null
  className?: string
  title?: string
  label?: string
}

/** The options of createFoamMarkdownIt() the app sets. */
export interface FoamMarkdownItOptions {
  workspace: FoamWorkspace
  parser: ResourceParser
  /** How a wiki link to a resource renders; linkFragment is the href's fragment, `#section-slug` or `#__blockid`. */
  linkResolver: (input: { resource: Resource; linkFragment: string; formattedFragment: string; alias: string | undefined }) => ResolvedLinkRendering
  /** The resource shown, for `$current` and embeds of its own sections. */
  getCurrentResource: () => Resource | null
  /** The instance embedded notes render with; it is called mid-render. */
  createInnerMd?: () => MarkdownIt
  /** Plugins added last, which can override Foam's. */
  extensions?: ((md: MarkdownIt) => void)[]
}

/** Foam's preview pipeline on target: wiki links, embeds, tags, block anchors and footnotes, its queries left out. */
export function createFoamMarkdownIt(options: FoamMarkdownItOptions, target?: MarkdownIt): MarkdownIt
