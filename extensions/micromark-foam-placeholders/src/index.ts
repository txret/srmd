/**
 * Placeholders for Foam's syntax, for micromark: notes written for Foam read cleanly, without Foam's features.
 * - A block anchor, `^id` (ASCII letters, digits and `-`) after whitespace or a line ending, or alone, at the end of
 *   a text, is hidden.
 * - A wiki link, `[[target|label]]`, or an embed, `![[target|label]]`, renders as the text `label: target`, or
 *   `Link to target` without a label. The target is shown as written, with any `#fragment`. In a GFM table, the
 *   divider is written `\|`.
 * Tags, `#tag`, are ordinary text already.
 *
 * Use: `micromark(value, { extensions: [foam_placeholders()], htmlExtensions: [foam_placeholders_html()] })`.
 */
import { markdownLineEnding as is_eol, markdownLineEndingOrSpace as is_space_or_eol, markdownSpace as is_space } from 'micromark-util-character'
import type { Code, CompileContext, Effects, Extension, HtmlExtension, State, Token, TokenizeContext } from 'micromark-util-types'

/** Whether a code may be part of an anchor id. */
const is_id_code = (code: Code): boolean => code !== null &&
  ((code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 45 /*-*/)

/**
 * Tokenize a block anchor positioned at `^`: an id, then only spaces or tabs to the end of the text.
 * @param nok - Leave `^` to ordinary text: no id, or more text after it.
 */
function tokenize_anchor(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  /** Whether the id has a character yet, and whether spaces follow it, after which only spaces may come. */
  let named = false
  let spaced = false
  return start

  /** Open the anchor at `^`. */
  function start(code: Code): State | undefined {
    effects.enter('blockAnchor')
    effects.consume(code)
    return inside
  }

  /** Read the id and the spaces after it; accept only at the end of the text (null). */
  function inside(code: Code): State | undefined {
    if ((is_id_code(code) && !spaced) || (named && is_space(code))) {
      named = true
      spaced ||= is_space(code)
      effects.consume(code)
      return inside
    }
    if (!named || code !== null) return nok(code)
    effects.exit('blockAnchor')
    return ok(code)
  }
}

/**
 * Tokenize a wiki link positioned at `[`, or an embed at `!`: `[[`, then up to the first `]]` on the same line.
 * @param nok - Leave the brackets to ordinary Markdown: no closing `]]` on the line, another bracket inside, or
 *   nothing visible before the divider, as in `[[]]` or `[[ |x]]`.
 */
function tokenize_link(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  /** Opening brackets still to read. */
  let brackets = 2
  /** Whether the target has a visible character, and whether the divider was read, after which anything goes. */
  let named = false
  let divided = false
  return start

  /** Open the link; an embed starts with `!`. */
  function start(code: Code): State | undefined {
    effects.enter('wikiLink')
    if (code !== 33 /*!*/) return open(code)
    effects.consume(code)
    return open
  }

  /** Consume `[[`. */
  function open(code: Code): State | undefined {
    if (code !== 91 /*[*/) return nok(code)
    effects.consume(code)
    return --brackets ? open : inside
  }

  /** Read characters up to `]`. */
  function inside(code: Code): State | undefined {
    if (code === null || is_eol(code) || code === 91 /*[*/) return nok(code)
    if (code === 93 /*]*/) {
      if (!named) return nok(code)
      effects.consume(code)
      return close
    }
    if (code === 124 /*|*/) divided = true
    else if (!divided && !is_space_or_eol(code)) named = true
    effects.consume(code)
    return inside
  }

  /** Require the second `]`. */
  function close(code: Code): State | undefined {
    if (code !== 93 /*]*/) return nok(code)
    effects.consume(code)
    effects.exit('wikiLink')
    return ok
  }
}

/** A link or embed as text, from its source: `label: target`, or `Link to target`. */
function link_text(source: string): string {
  /* Drop the brackets and the embed's `!`, then split at the first divider, `|` or `\|`. */
  const inner = source.replace(/^!?\[\[|\]\]$/g, '')
  const divider = /\\?\|/.exec(inner)
  if (!divider) return `Link to ${inner}`
  return `${inner.slice(divider.index + divider[0].length)}: ${inner.slice(0, divider.index)}`
}

/**
 * The syntax: anchors in text after whitespace, a line ending or at the start of the text; links and embeds
 * anywhere in text.
 */
export function foam_placeholders(): Extension {
  return {
    text: {
      94: { name: 'blockAnchor', tokenize: tokenize_anchor, previous: code => code === null || is_space_or_eol(code) },
      91: { name: 'wikiLink', tokenize: tokenize_link },
      33: { name: 'wikiLink', tokenize: tokenize_link }
    }
  }
}

/** The HTML: anchors render nothing; links and embeds render as escaped text. */
export function foam_placeholders_html(): HtmlExtension {
  return {
    exit: {
      blockAnchor() {},
      wikiLink(this: CompileContext, token: Token) {
        this.raw(this.encode(link_text(this.sliceSerialize(token))))
      }
    }
  }
}

// Extend micromark's token union instead of weakening token.type to string.
declare module 'micromark-util-types' {
  interface TokenTypeMap {
    blockAnchor: 'blockAnchor'
    wikiLink: 'wikiLink'
  }
}
