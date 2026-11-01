import type * as vscode from 'vscode'
import type MarkdownIt from 'markdown-it'
import { parse, srmd_plugin, type SrmdEnv } from '@srmd/parser'
import { workspace_path } from './filesystem'
import type { Settings } from './settings'

export type { default as MarkdownIt } from 'markdown-it'

/** The preview's render environment; currentDocument is absent when VS Code renders text that is not a document. */
interface RenderEnv {
  currentDocument?: vscode.Uri
  srmd?: SrmdEnv
}

/** Options of srmd's markdown-it plugin, which the extension's extendMarkdownIt() takes after the instance. */
export interface PluginOptions {
  /**
   * Add srmd to the instance reviews parse and render notes with (see markdown.ts), not to VS Code's Markdown preview:
   * with the source positions saving needs, for the parses srmd makes.
   */
  review?: boolean
}

/**
 * srmd's markdown-it plugin: srmd's syntax only, as other extensions add theirs, such as Foam its wiki links, embeds and
 * block anchors. In VS Code's Markdown preview, the default, notes show with every cloze shown and marked as in the
 * review (SYNTAX.md, "HTML"), which the preview stylesheet `media/preview.css` outlines, and other extensions' syntax
 * and VS Code's front matter, highlighting and scroll sync apply to them as to other documents; other documents, and
 * every document while srmd is off, render as before. For reviews, the instance parses and renders the notes reviewed.
 * @param md - The instance, changed in place.
 * @param settings - The settings in effect, read at every preview render, so a change applies at the next one.
 * @returns md, which VS Code's extendMarkdownIt() contract requires.
 */
export function extend_markdown_it<T extends MarkdownIt>(md: T, settings: () => Settings, options: PluginOptions = {}): T {
  /*
   * 1. srmd's syntax applies to a parse whose environment carries `env.srmd`, which only srmd sets; for reviews the
   *    instance records positions too.
   * 2. Wrap parse(): a parse while a note renders is of Markdown the note embeds, as Foam renders its embeds through
   *    the instance it extends. srmd's syntax applies to it, its clozes with ordinal 0, as it is not the note reviewed.
   *    The preview also remembers the source of each token array: VS Code parses without naming the document, so
   *    whether the text is a note is only known once it is rendered.
   * 3. Wrap renderer.render() to count a note's render. In the preview, a note's remembered source is parsed again in
   *    the render's environment, now with srmd's syntax and the cards srmd's own parse found, whose matching of
   *    definitions needs the source positions only srmd's own instance records there. Anything else renders as before.
   */
  srmd_plugin(md, { positions: options.review })
  /**
   * The source of each token array parse() returned in the preview. VS Code renders a cached array again on each
   * preview update, so the source must outlive the parse; weak keys release it with the array.
   */
  const sources = new WeakMap<object, string>()
  /** How many note renders are in progress: what is parsed meanwhile is Markdown a note embeds. */
  let rendering = 0

  const parse_tokens = md.parse.bind(md)
  md.parse = (source: string, env: RenderEnv | undefined) => {
    if (rendering && env && !env.srmd) env.srmd = { embedded: true }
    const tokens = parse_tokens(source, env)
    if (!options.review) sources.set(tokens, source)
    return tokens
  }

  // Step 3: rendering.
  const render_tokens = md.renderer.render.bind(md.renderer)
  /** Render a note's tokens, counting the render while it lasts. */
  const render_note: typeof render_tokens = (tokens, render_options, env) => {
    rendering++
    try {
      return render_tokens(tokens, render_options, env)
    } finally {
      rendering--
    }
  }
  md.renderer.render = (tokens, render_options, env: RenderEnv | undefined) => {
    if (options.review) return env?.srmd ? render_note(tokens, render_options, env) : render_tokens(tokens, render_options, env)
    const source = sources.get(tokens)
    const { enabled, suffixes } = settings()
    const path = env?.currentDocument && workspace_path(env.currentDocument)
    if (!env || env.srmd || source === undefined || !path || !enabled || !suffixes.some(suffix => path.endsWith(suffix))) {
      return render_tokens(tokens, render_options, env)
    }
    env.srmd = { scheduling: parse(source).scheduling }
    return render_note(parse_tokens(source, env), render_options, env)
  }
  return md
}
