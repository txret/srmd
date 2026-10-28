import type * as vscode from 'vscode'
import { parse, serialize_card, transcribe, type Transcript, type TranscriptCloze, type TranscriptMarks } from '@srmd/parser'
import type { Settings } from './settings'

/** A markdown-it token, as far as the preview plugin reads and writes it. */
interface Token {
  type: string
  tag: string
  /** 1 opens an element, -1 closes one, 0 is self-contained. */
  nesting: number
  level: number
  /** A block token's first line and the line after its last, zero-based. */
  map: [number, number] | null
  content: string
  children: Token[] | null
  attrs: [string, string][] | null
  block: boolean
}

/** markdown-it's state for core rules, which see a document's block tokens with their inline children. */
interface CoreState {
  env: unknown
  tokens: Token[]
  Token: new (type: string, tag: string, nesting: number) => Token
}

/** The preview's render environment; currentDocument is absent when VS Code renders text that is not a document. */
interface RenderEnv {
  currentDocument?: vscode.Uri
}

/**
 * The parts of markdown-it the preview plugin uses. VS Code's Markdown preview supplies the instance: it parses a
 * document's text without naming the document, caches the token array, and renders that array on every preview
 * update with the document in the environment. Declared here rather than bundling markdown-it or its types.
 */
export interface MarkdownIt {
  parse(source: string, env: unknown): Token[]
  renderer: { render(tokens: Token[], options: unknown, env: RenderEnv | undefined): string }
  core: { ruler: { after(after_name: string, name: string, rule: (state: CoreState) => void): void } }
  /** linkify-it, whose matchAtStart() markdown-it 13 and later call while parsing inline content. */
  linkify?: { matchAtStart?(text: string): unknown }
}

/**
 * Non-ASCII punctuation without Markdown meaning, from which each note's marks are chosen (see TranscriptMarks).
 * markdown-it's emphasis rules treat it as they treat the srmd markers' own punctuation.
 */
const mark_candidates = '⸀⸁⸆⸇⸈⸋⸎⸏⸐⸑⸒⸓'

/**
 * Show notes in VS Code's Markdown preview with every cloze shown and marked as in the review. A note renders
 * through the preview's own markdown-it, with every extension's plugins, from a transcript without srmd syntax
 * (see transcribe()). The transcript's marks become the review's cloze elements (SYNTAX.md, "HTML"), which the
 * preview stylesheet `media/preview.css` outlines. Other documents, and every document while srmd is off, render
 * as before.
 * @param md - The preview's markdown-it instance, changed in place.
 * @param settings - The settings in effect, read at every render, so a change applies at the next one.
 * @returns md, which VS Code's extendMarkdownIt() contract requires.
 */
export function extend_markdown_it<T extends MarkdownIt>(md: T, settings: () => Settings): T {
  /*
   * 1. Wrap parse() to remember the source of each token array it returns: VS Code parses without naming the
   *    document, so whether the text is a note is only known once it is rendered.
   * 2. Wrap renderer.render(): a note's remembered source is transcribed by the shared parser, with the configured
   *    extensions, then parsed again in the render's environment, which plugins collecting from the parse to render,
   *    such as footnotes, share. Anything else renders as before.
   * 3. During that second parse only, a core rule turns the marks into cloze tokens before linkify and typography
   *    see the text, and a link found while parsing inline content ends at a mark.
   */
  /**
   * The source of each token array parse() returned. VS Code renders a cached array again on each preview update,
   * so the source must outlive the parse; weak keys release it with the array.
   */
  const sources = new WeakMap<object, string>()
  /** The transcript of a note being parsed again, by the environment object of that parse. */
  const transcripts = new WeakMap<object, { transcript: Transcript; marks: TranscriptMarks }>()
  /** The marks of the note being parsed again, which no link may contain; null outside that parse. */
  let marks_pattern: RegExp | null = null

  const parse_tokens = md.parse.bind(md)
  md.parse = (source, env) => {
    const tokens = parse_tokens(source, env)
    sources.set(tokens, source)
    return tokens
  }

  const render_tokens = md.renderer.render.bind(md.renderer)
  md.renderer.render = (tokens, options, env) => {
    const source = sources.get(tokens)
    const { enabled, suffixes, extensions } = settings()
    const path = env?.currentDocument?.path
    if (env === undefined || source === undefined || path === undefined || !enabled || !suffixes.some(suffix => path.endsWith(suffix))) {
      return render_tokens(tokens, options, env)
    }
    const marks = choose_marks(source)
    if (!marks) return render_tokens(tokens, options, env)
    const transcript = transcribe(parse(source, extensions), marks)
    transcripts.set(env, { transcript, marks })
    marks_pattern = new RegExp(`[${marks.open}${marks.close}${marks.filler}]`)
    let note_tokens: Token[]
    try {
      note_tokens = parse_tokens(transcript.markdown, env)
    } finally {
      transcripts.delete(env)
      marks_pattern = null
    }
    return render_tokens(note_tokens, options, env)
  }

  // 3. Right after inline parsing, before linkify, typography and other extensions' later core rules.
  md.core.ruler.after('inline', 'srmd_clozes', state => {
    const note = transcripts.get(state.env as object)
    if (note) state.tokens = mark_clozes(state, note.transcript, note.marks)
  })
  // A URL's path may contain punctuation, so it would take the close mark or filler following it.
  const linkify = md.linkify
  if (linkify?.matchAtStart) {
    const match_at_start = linkify.matchAtStart.bind(linkify)
    linkify.matchAtStart = text => {
      const end = marks_pattern ? text.search(marks_pattern) : -1
      return match_at_start(end < 0 ? text : text.slice(0, end))
    }
  }
  return md
}

/** Three mark candidates absent from a note's source, as its open, close and filler marks; null if fewer are left. */
function choose_marks(source: string): TranscriptMarks | null {
  const [open, close, filler] = [...mark_candidates].filter(char => !source.includes(char))
  return filler === undefined ? null : { open, close, filler }
}

/**
 * Turn a transcribed note's marks into the review's cloze elements, and remove what stands in for srmd syntax.
 * @param state - The core state of the transcript's parse, after inline parsing.
 * @param transcript - The transcript parsed.
 * @param marks - The marks it was transcribed with.
 * @returns The block tokens to keep, with div tokens around each block cloze's blocks.
 */
function mark_clozes(state: CoreState, transcript: Transcript, marks: TranscriptMarks): Token[] {
  /*
   * 1. Split the text of every inline token at the marks: open and close marks become span tokens, balanced within
   *    their inline token, and the filler goes. A paragraph left without content goes too, as the review drops a
   *    paragraph holding only explicit markers or references. Marks other tokens took in, as a plugin's syntax
   *    the parser does not know can, are removed.
   * 2. Drop the thematic breaks standing in for definitions and reference lines.
   * 3. Find each block cloze's blocks: the block starting on its start line at its nesting level, and the
   *    following blocks of the same container starting by its end line.
   * 4. Rebuild the token list with div tokens around those blocks.
   */
  const { tokens } = state
  const any_mark = new RegExp(`[${marks.open}${marks.close}${marks.filler}]`, 'g')
  const each_mark = new RegExp(`([${marks.open}${marks.close}${marks.filler}])`)
  /** Tokens left out, by index. */
  const dropped: boolean[] = []
  /** Div tokens to insert before and after the token at an index. */
  const before: Token[][] = []
  const after: Token[][] = []
  /** Index of the next inline cloze, in the order of the open marks. */
  let next = 0

  /** Split text tokens at the marks; spans still open at the end of the list close there. */
  const split = (children: Token[]): Token[] => {
    /* Copy the tokens, replacing each text holding marks by its pieces, then close what is left open. */
    const result: Token[] = []
    /** Spans opened in this list and not closed. */
    let open = 0
    for (const child of children) {
      // An image's description is inline content of its own.
      if (child.children) child.children = split(child.children)
      if (child.type !== 'text') {
        child.content = child.content.replace(any_mark, '')
        result.push(child)
        continue
      }
      for (const piece of child.content.split(each_mark)) {
        if (piece === marks.open) {
          result.push(cloze_token(state, 'span', 1, child.level, transcript.inline[next++]))
          open++
        } else if (piece === marks.close) {
          if (open > 0) result.push(cloze_token(state, 'span', -1, child.level))
          open = Math.max(open - 1, 0)
        } else if (piece !== marks.filler && piece !== '') {
          const text = new state.Token('text', '', 0)
          text.content = piece
          text.level = child.level
          result.push(text)
        }
      }
    }
    for (; open > 0; open--) result.push(cloze_token(state, 'span', -1, 0))
    return result
  }

  // 1–2. Inline content, emptied paragraphs and the stand-ins for card metadata.
  tokens.forEach((token, index) => {
    if (token.type === 'inline' && token.children) {
      token.children = split(token.children)
      if (tokens[index - 1]?.type === 'paragraph_open' && token.children.every(is_blank)) {
        dropped[index - 1] = dropped[index] = dropped[index + 1] = true
      }
    } else if (token.type === 'hr' && token.map && transcript.metadata_lines.includes(token.map[0])) {
      dropped[index] = true
    } else {
      token.content = token.content.replace(any_mark, '')
    }
  })

  // 3. Block clozes. In markdown-it a list adds two levels, for the list and its item, and a quote one.
  for (const cloze of transcript.block) {
    const level = cloze.containers.reduce((sum, kind) => sum + (kind === 'list' ? 2 : 1), 0)
    const first = tokens.findIndex(token =>
      token.level === level && token.nesting !== -1 && token.type !== 'inline' && token.map?.[0] === cloze.start_line)
    if (first < 0) continue
    /** The token ending the cloze's last block so far: a self-contained block, or the closing token of its level. */
    let last = first
    for (let index = first; index < tokens.length && tokens[index].level >= level; index++) {
      const token = tokens[index]
      if (token.level !== level || token.nesting === -1) continue
      if (token.map && token.map[0] > cloze.end_line) break
      // The first closing token of the level after an opening one closes it.
      if (token.nesting === 1) {
        while (index + 1 < tokens.length && !(tokens[index + 1].level === level && tokens[index + 1].nesting === -1)) index++
        index++
      }
      last = index
    }
    // An enclosing cloze, listed first, opens first and closes last.
    before[first] = [...before[first] ?? [], cloze_token(state, 'div', 1, level, cloze)]
    after[last] = [cloze_token(state, 'div', -1, level), ...after[last] ?? []]
  }

  // 4. Rebuild the token list.
  const result: Token[] = []
  tokens.forEach((token, index) => {
    result.push(...before[index] ?? [])
    if (!dropped[index]) result.push(token)
    result.push(...after[index] ?? [])
  })
  return result
}

/**
 * A span or div token opening a cloze, with its card's attributes as the review renders them, or closing one.
 * markdown-it renders tokens without a renderer rule of their own from their tag, nesting and attributes.
 */
function cloze_token(state: CoreState, tag: 'span' | 'div', nesting: 1 | -1, level: number, cloze?: TranscriptCloze): Token {
  /* Create the token, then give an opening one its class and, when its cloze is known, the card's attributes. */
  const token = new state.Token(nesting === 1 ? 'srmd_cloze_open' : 'srmd_cloze_close', tag, nesting)
  token.block = tag === 'div'
  token.level = level
  if (nesting === 1) {
    token.attrs = [['class', 'cloze']]
    if (cloze) token.attrs.push(['data-ordinal', String(cloze.ordinal)], ['data-card', serialize_card(cloze.scheduling)])
  }
  return token
}

/** Whether an inline token shows nothing: a line break, a cloze tag, or blank text. */
function is_blank(token: Token): boolean {
  return token.type === 'softbreak' || token.type === 'hardbreak' || token.type.startsWith('srmd_cloze_') ||
    (token.type === 'text' && token.content.trim() === '')
}
