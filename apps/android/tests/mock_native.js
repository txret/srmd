// A stand-in for the Android shell in a browser: the `srmd` channel answering the bridge's requests from files held in
// memory (see src/bridge.ts and ARCHITECTURE.md, "Bridge messages"). Loaded before the app by tests/browser.mjs, which
// first defines window.mock_setup: { files: { path: text }, settings, root, language, now }.
// window.mock_native exposes the files and what the app asked the shell to do, and acts as the user towards the shell.
(() => {
  const setup = window.mock_setup
  // A fixed clock makes saved reviews exact; timers still run in real time.
  if (setup.now !== undefined) {
    const RealDate = Date
    window.Date = class extends RealDate {
      constructor(...args) {
        if (args.length) super(...args)
        else super(setup.now)
      }
      static now() { return setup.now }
    }
  }

  /** Files by path: their text and modification time, which each write increases. */
  const files = {}
  for (const [path, text] of Object.entries(setup.files)) files[path] = { text, mtime: 1000 }
  /** What the app asked of the shell: settings stored, writes, files and links opened outside, whether Back is handled. */
  const state = {
    settings: setup.settings ?? null, root: setup.root === undefined ? { name: 'notes' } : setup.root, back_handled: false,
    writes: [], opened: [], links: [], exited: false, keyboard_requests: 0
  }
  const size = text => new TextEncoder().encode(text).length
  /** Whether a name matches a skip pattern, `*` standing for any characters, ignoring case, as the shell matches. */
  const matches = (name, pattern) => new RegExp(`^${pattern.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i').test(name)
  /** A refusal as the shell sends it. */
  const refuse = (code, message) => Object.assign(new Error(message), { code })

  /** Answer one request, as the shell does. */
  function handle(method, params) {
    switch (method) {
      case 'app.start':
        return { settings: state.settings, root: state.root, language: setup.language ?? 'en', insets: { top: 24, bottom: 16, left: 0, right: 0, keyboard: false } }
      case 'settings.set':
        state.settings = params.settings
        return {}
      case 'root.pick':
        state.root = { name: 'picked' }
        return { root: state.root }
      case 'files.scan':
        if (!state.root) throw refuse('no_root', 'No notes folder')
        return {
          entries: Object.entries(files)
            .filter(([path]) => !path.split('/').some(name => params.skip.some(pattern => matches(name, pattern))))
            .map(([path, file]) => ({ path, mtime: file.mtime, size: size(file.text) }))
        }
      case 'files.read': {
        const file = files[params.path]
        if (!file) throw refuse('not_found', `${params.path} does not exist`)
        return { text: file.text, mtime: file.mtime, size: size(file.text) }
      }
      case 'files.load': {
        const file = files[params.path]
        if (!file) throw refuse('not_found', `${params.path} does not exist`)
        return { text: file.text }
      }
      case 'files.write': {
        const file = files[params.path]
        if (!file) throw refuse('not_found', `${params.path} does not exist`)
        if (params.expected_mtime !== undefined && params.expected_mtime !== file.mtime) throw refuse('conflict', `${params.path} changed`)
        files[params.path] = { text: params.text, mtime: file.mtime + 1 }
        state.writes.push([params.path, params.text])
        return { mtime: file.mtime + 1, size: size(params.text) }
      }
      case 'files.open':
        state.opened.push(params.path)
        return {}
      case 'link.open':
        state.links.push(params.url)
        return {}
      case 'back.set':
        state.back_handled = params.handled
        return {}
      case 'keyboard.show':
        state.keyboard_requests++
        return {}
      default:
        throw refuse('io', `Unknown method ${method}`)
    }
  }

  /** Send a message to the page as the shell does, after the current task. */
  const send = message => setTimeout(() => channel.onmessage?.({ data: JSON.stringify(message) }))
  const channel = {
    onmessage: null,
    postMessage(data) {
      const { id, method, params } = JSON.parse(data)
      try {
        send({ id, result: handle(method, params) })
      } catch (error) {
        send({ id, error: { code: error.code ?? 'io', message: error.message } })
      }
    }
  }
  window.srmd = channel
  window.mock_native = {
    files,
    state,
    /** Press Back: the page hears it while it reported something open; otherwise Android leaves the app. */
    back() {
      if (state.back_handled) send({ event: 'back' })
      else state.exited = true
    },
    /** Send an event, such as resume after time away. */
    emit(event, params = {}) { send({ event, params }) },
    /** Change a file as a sync would, which changes its time. */
    sync(path, text) { files[path] = { text, mtime: (files[path]?.mtime ?? 1000) + 100 } }
  }
})()
