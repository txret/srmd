const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { createContext, runInContext } = require('node:vm')

/** Create the DOM methods used by review controls; layout is outside these host tests. */
function element(classes = '', dataset = {}, tag = 'div', parent = null) {
  /* Use native event dispatch and a small class list so the real UI handles clicks and shortcuts. */
  const names = new Set(classes.split(' ').filter(Boolean))
  return Object.assign(new EventTarget(), {
    dataset,
    tagName: tag.toUpperCase(),
    isConnected: true,
    /**
     * Match a tag name, a single class selector or a tag with a class, or a list of these separated by commas, on this
     * element or its ancestors; other selectors match nothing.
     */
    closest(selector) {
      const parts = selector.split(',').map(part => part.trim())
      for (let node = this; node; node = node.parent) {
        for (const part of parts) {
          if (part === node.tag) return node
          if (part.startsWith('.') && !part.includes(' ') && !part.slice(1).includes('.') && node.classList.contains(part.slice(1))) return node
          const [tag, name, more] = part.split('.')
          if (tag && name && more === undefined && tag === node.tag && node.classList.contains(name)) return node
        }
      }
      return null
    },
    tag,
    parent,
    classList: {
      add: (...values) => values.forEach(value => names.add(value)),
      remove: (...values) => values.forEach(value => names.delete(value)),
      contains: value => names.has(value),
      /** Match DOMTokenList.toggle's optional force argument. */
      toggle(value, force = !names.has(value)) {
        /* Add or remove the class and return its resulting presence. */
        if (force) names.add(value)
        else names.delete(value)
        return force
      }
    },
    contains: () => false,
    focus() {},
    scrollIntoView() {}
  })
}

/** Materialize one card's controls from its markup, like assigning it to the container's innerHTML. */
function card_view(markup) {
  /* Build the root, clozes and choices the shared reviewer queries, then expose browser-like input helpers. */
  const root = element(markup.match(/^<div id="review-root" class="([^"]*)"/)[1])
  const clozes = [...markup.matchAll(/<(?:span|div) class="cloze" data-ordinal="(\d+)" data-card="([^"]+)">/g)]
    .map(([, ordinal, card]) => element('cloze', { ordinal, card }))
  const choices = [...markup.matchAll(/<button type="button" data-id="([^"]+)" class="([^"]+)">/g)]
    .map(([, id, classes]) => element(classes, { id }, 'button'))
  /** Each choice's interval text, a span inside its button. */
  const details = new Map(choices.map(choice => [choice.dataset.id, element('detail', {}, 'span', choice)]))
  const content = Object.assign(element(), { querySelectorAll: () => clozes, children: [] })
  const search = Object.assign(element(), { querySelector: () => element() })
  /** Foam's links in the note, with the workspace path a resolved one points at. */
  const links = [...markup.matchAll(/<a class="(foam-note-link|foam-placeholder-link)"[^>]*?(?: data-href="([^"]*)")?>/g)]
    .map(([, name, href]) => element(name, href === undefined ? {} : { href }, 'a'))
  const flip = element('flip-btn', {}, 'button')
  root.querySelector = selector => {
    /* Supply only the selectors the shared reviewer uses during setup and rating. */
    if (selector === '.content') return content
    if (selector === '.search') return search
    if (selector === '.choice-btn.default') return choices.find(choice => choice.classList.contains('default'))
    throw new Error(`Unexpected reviewer selector: ${selector}`)
  }
  return {
    root,
    /** Report the UI's active group, which may differ from its persisted reference. */
    active_ordinals: () => clozes.filter(cloze => cloze.classList.contains('active')).map(cloze => Number(cloze.dataset.ordinal)),
    /** Bubble a button click to the mounted review root. */
    choose(choice_id) {
      /* Reveal the back before rating, then let the real UI and app bridge handle the choice. */
      const choice = choices.find(button => button.dataset.id === choice_id)
      assert.ok(choice, `Missing review choice: ${choice_id}`)
      if (root.classList.contains('front')) {
        const reveal = new Event('click')
        Object.defineProperty(reveal, 'target', { value: flip })
        root.dispatchEvent(reveal)
      }
      const click = new Event('click')
      Object.defineProperty(click, 'target', { value: choice })
      root.dispatchEvent(click)
    },
    /** Click the note's link at index, returning whether the reviewer kept the webview from following it. */
    click_link(index) {
      const click = new Event('click', { cancelable: true })
      Object.defineProperty(click, 'target', { value: links[index] })
      root.dispatchEvent(click)
      return click.defaultPrevented
    },
    /** Click the interval text inside a choice's button. */
    click_detail(choice_id) {
      const click = new Event('click')
      Object.defineProperty(click, 'target', { value: details.get(choice_id) })
      root.dispatchEvent(click)
    },
    /** Press Space while a choice's button has focus; returns whether the reviewer prevented its native activation. */
    press_space_on(choice_id) {
      const event = Object.assign(new Event('keydown', { cancelable: true }), {
        key: ' ', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false
      })
      Object.defineProperty(event, 'target', { value: choices.find(choice => choice.dataset.id === choice_id) })
      root.dispatchEvent(event)
      return event.defaultPrevented
    },
    /** Send the default shortcut through the real shared keyboard handler; repeat models a held key. */
    press_space(repeat = false) {
      /* Keyboard events bubble from the focused review root; native cancellation remains observable. */
      const event = Object.assign(new Event('keydown', { cancelable: true }), {
        key: ' ', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, repeat
      })
      root.dispatchEvent(event)
      assert.equal(event.defaultPrevented, true)
    }
  }
}

/**
 * Run the VS Code reviewer bundle in the tab's static document with DOM/VS Code adapters.
 * Cards arrive through deliver(), like messages the extension posts; each replaces the shown card.
 */
function open_webview(html, post_message) {
  /* Read the document's container settings and base, run its only script, then expose the shown card. */
  const config = html.match(/<div id="review" data-config="([^"]*)"><\/div>/)[1]
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&amp;/g, '&')
  const base = { href: html.match(/<base href="([^"]*)" \/>/)[1] }
  /** The card the document shows; replaced by every card message. */
  let card
  const container = {
    dataset: { config },
    set innerHTML(markup) { card = card_view(markup) },
    get firstElementChild() { return card.root }
  }
  const window = new EventTarget()
  // Every document can acquire the VS Code API only once.
  let acquired = false
  /** Layout observers currently observing; one per shown card. */
  let observers = 0
  const context = createContext({
    window,
    CustomEvent,
    NodeFilter: { SHOW_TEXT: 4 },
    // Layout never changes here; observers are only counted, so tests can see each card release its own.
    ResizeObserver: class {
      observe() { if (!this.observing) observers++; this.observing = true }
      disconnect() { if (this.observing) observers--; this.observing = false }
    },
    requestAnimationFrame: callback => setTimeout(callback, 0),
    cancelAnimationFrame: handle => clearTimeout(handle),
    document: {
      getElementById: id => id === 'review' ? container : null,
      querySelector: selector => {
        if (selector === 'base') return base
        throw new Error(`Unexpected document selector: ${selector}`)
      },
      createRange: () => ({ setStart() {}, setStartAfter() {}, setEndBefore() {} }),
      createTreeWalker: () => ({ nextNode: () => null })
    },
    /** Model VS Code's single acquisition per webview document. */
    acquireVsCodeApi() {
      /* A second acquisition indicates that two scripts claimed the API. */
      assert.equal(acquired, false)
      acquired = true
      return { postMessage: message => post_message(structuredClone(message)) }
    }
  })
  // The document has exactly one script, the bundled reviewer, and no inline code.
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
  assert.deepEqual(scripts.map(([, attributes, code]) => [attributes, code]), [[' src="https://resources.test/extension/dist/reviewer.js"', '']])
  runInContext(readFileSync(`${__dirname}/../dist/reviewer.js`, 'utf8'), context)
  assert.equal(acquired, true)

  return {
    /** Dispatch a message from the extension to the document's listener. */
    deliver(message) {
      window.dispatchEvent(Object.assign(new Event('message'), { data: message }))
    },
    /** The shown card, or undefined before the first card message. */
    get card() { return card },
    /** The document's current base URL for relative note resources. */
    get base() { return base.href },
    /** Layout observers still observing. */
    get observers() { return observers }
  }
}

module.exports = { open_webview }
