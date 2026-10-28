/** The web app's entry point: connect to the shell, select the language, open the cache and start the app. */
import { set_language } from '@srmd/l10n'
import { App, type Elements } from './app'
import { Bridge, type Channel } from './bridge'
import { Cache } from './cache'

declare global {
  interface Window {
    /** The shell's message channel, injected before the page's scripts run. */
    srmd?: Channel
    /** The running app, for debugging through Chrome's remote inspector. */
    srmd_app?: App
  }
}

/** The page's element with this id. */
const by_id = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T

/** Start the app; without the shell's channel, as in a plain browser, say so instead. */
async function main(): Promise<void> {
  /* Ask the shell for settings, folder, language and insets first: every text depends on the language. */
  const channel = window.srmd
  if (!channel) {
    document.body.textContent = 'srmd needs its Android app: the page was opened without it.'
    return
  }
  const bridge = new Bridge(channel)
  const start = await bridge.request('app.start', {})
  set_language(start.language)
  const cache = await Cache.open(message => console.warn(`srmd: ${message}`))
  const elements: Elements = {
    main: by_id('main'), view: by_id('view'), review: by_id('review'), editor: by_id('editor'), empty: by_id('empty'),
    note_search: by_id('note-search'), handle: by_id('handle'), scrim: by_id('scrim'), drawer: by_id('drawer'),
    tree: by_id('tree'), library_search: by_id<HTMLInputElement>('library-search'), toggle: by_id<HTMLButtonElement>('toggle'),
    format: by_id<HTMLButtonElement>('format'), review_shown: by_id<HTMLButtonElement>('review-shown'),
    open_settings: by_id<HTMLButtonElement>('open-settings'),
    settings: by_id('settings'), dialog: by_id('dialog'), toast: by_id('toast')
  }
  const app = new App(bridge, cache, elements, start.settings ?? {}, start.root)
  window.srmd_app = app
  await app.start(start.insets)
}

void main()
