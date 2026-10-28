// Running the built web app in headless Chromium with the mock shell (mock_native.js), for the end-to-end tests and
// for trying the app in a desktop browser: `node tests/browser.mjs <notes folder>` serves a folder's notes.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { extname, join, relative } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

/** The web build the APK packages, which `npm run build` writes. */
const web = join(import.meta.dirname, '../native/app/src/main/assets/web')

/** Content types of the files served. */
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' }

/**
 * Serve the app as the shell's asset loader does, under /app/, with the mock shell loaded before the app script, and
 * the notes under /notes/. setup is read per page load: { files: { path: text }, settings, root, language, now,
 * still }. With still, nothing animates, so a tap never lands on a drawer still sliding away.
 * @returns The server's origin and a way to close it; assign server.setup before loading a page.
 */
export async function start_server(setup = { files: {} }) {
  const server = {
    setup,
    origin: '',
    close: () => new Promise(resolve => http.close(resolve))
  }
  const http = createServer((request, response) => {
    /* Route by path prefix; the page itself gets the mock's scripts inserted before the app's. */
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    const send = (body, type) => {
      response.writeHead(200, { 'Content-Type': type })
      response.end(body)
    }
    if (path === '/app/index.html') {
      const page = readFileSync(join(web, 'index.html'), 'utf8')
        .replace('<script src="/app/app.js"></script>', '<script src="/mock/setup.js"></script><script src="/mock/native.js"></script><script src="/app/app.js"></script>')
      send(server.setup.still ? page.replace('</head>', '<link rel="stylesheet" href="/mock/still.css">\n</head>') : page, types['.html'])
    } else if (path === '/mock/setup.js') send(`window.mock_setup = ${JSON.stringify(server.setup)}`, types['.js'])
    else if (path === '/mock/still.css') send('*, *::before, *::after { transition: none !important; animation: none !important }', types['.css'])
    else if (path === '/mock/native.js') send(readFileSync(join(import.meta.dirname, 'mock_native.js')), types['.js'])
    else if (path.startsWith('/app/') && existsSync(join(web, path.slice(5)))) send(readFileSync(join(web, path.slice(5))), types[extname(path)] ?? 'application/octet-stream')
    else if (path.startsWith('/notes/') && path.slice(7) in server.setup.files) send(server.setup.files[path.slice(7)], types[extname(path)] ?? 'text/plain')
    else {
      response.writeHead(404)
      response.end()
    }
  })
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve))
  server.origin = `http://127.0.0.1:${http.address().port}`
  return server
}

/** A Chromium to test with: $CHROME, else Playwright's headless shell or a Chromium on the PATH; null when none is found. */
export function find_chromium() {
  /* Prefer an explicit path, then the newest Playwright download, then common names on the PATH. */
  if (process.env.CHROME) return process.env.CHROME
  const playwright = join(homedir(), '.cache/ms-playwright')
  if (existsSync(playwright)) {
    for (const name of readdirSync(playwright).filter(name => name.startsWith('chromium_headless_shell-')).sort().reverse()) {
      const shell = join(playwright, name, 'chrome-headless-shell-linux64/chrome-headless-shell')
      if (existsSync(shell)) return shell
    }
  }
  for (const directory of (process.env.PATH ?? '').split(':')) {
    for (const name of ['chromium', 'chromium-browser', 'google-chrome']) if (existsSync(join(directory, name))) return join(directory, name)
  }
  return null
}

/**
 * Launch Chromium headless and connect to it over the DevTools protocol. Each page gets its own browser context, so
 * IndexedDB starts empty.
 * @returns The browser: new_page() and close().
 */
export async function launch(executable) {
  /*
   * 1. Start Chromium with a fresh profile on a free debugging port, which it writes to the profile.
   * 2. Connect one WebSocket; commands carry their target's session id, replies and events are matched back.
   */
  const profile = mkdtempSync(join(tmpdir(), 'srmd-chromium-'))
  const process_ = spawn(executable, ['--headless', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
  const port_file = join(profile, 'DevToolsActivePort')
  for (let i = 0; i < 200 && !existsSync(port_file); i++) await delay(25)
  const [port, ws_path] = readFileSync(port_file, 'utf8').split('\n')
  const socket = new WebSocket(`ws://127.0.0.1:${port}${ws_path}`)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let next_id = 1
  const pending = new Map()
  const listeners = []
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data)
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) reject(new Error(`${message.error.message} ${message.error.data ?? ''}`))
      else resolve(message.result)
    } else for (const listener of listeners) listener(message)
  }
  /** Send a command, to a target's session or the browser. */
  const send = (method, params = {}, session) => new Promise((resolve, reject) => {
    const id = next_id++
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params, sessionId: session }))
  })

  return {
    /** A new phone-sized page with touch input, Stockholm's time zone, and the console collected. */
    async new_page() {
      const { browserContextId } = await send('Target.createBrowserContext')
      const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId })
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
      const page = make_page((method, params) => send(method, params, sessionId), listeners, sessionId)
      await page.send('Page.enable')
      await page.send('Runtime.enable')
      await page.send('Emulation.setDeviceMetricsOverride', { width: 412, height: 860, deviceScaleFactor: 1, mobile: true })
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
      await page.send('Emulation.setTimezoneOverride', { timezoneId: 'Europe/Stockholm' })
      page.close = () => send('Target.disposeBrowserContext', { browserContextId })
      return page
    },
    async close() {
      socket.close()
      process_.kill()
      await new Promise(resolve => process_.once('exit', resolve))
      rmSync(profile, { recursive: true, force: true })
    }
  }
}

/** A page: navigation, evaluation, touch input and waiting, over its DevTools session. */
function make_page(send, listeners, session) {
  /** Console messages and uncaught exceptions of the page, to show when a test fails. */
  const console_lines = []
  listeners.push(message => {
    if (message.sessionId !== session) return
    if (message.method === 'Runtime.consoleAPICalled') console_lines.push(`${message.params.type}: ${message.params.args.map(arg => arg.value ?? arg.description).join(' ')}`)
    if (message.method === 'Runtime.exceptionThrown') console_lines.push(`exception: ${message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text}`)
  })
  const page = {
    send,
    console: console_lines,
    /** Load a URL and wait for its load event. */
    async goto(url) {
      const loaded = new Promise(resolve => listeners.push(message => {
        if (message.sessionId === session && message.method === 'Page.loadEventFired') resolve()
      }))
      await send('Page.navigate', { url })
      await loaded
    },
    /** The value of an expression in the page, awaited; a thrown exception rejects. */
    async evaluate(expression) {
      const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (exceptionDetails) throw new Error(`${expression}: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`)
      return result.value
    },
    /**
     * Wait until an expression is truthy in the page, checking every 20 ms for three seconds. Only its truth crosses
     * over, since an element, such as CodeMirror's, may not survive serialization.
     */
    async wait_for(expression) {
      for (let i = 0; i < 150; i++) {
        if (await page.evaluate(`Boolean(${expression})`).catch(() => false)) return
        await delay(20)
      }
      throw new Error(`Timed out waiting for ${expression}\n${console_lines.join('\n')}`)
    },
    /** The center of the first element matching selector, in CSS pixels. */
    async center(selector) {
      const point = await page.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
      if (!point) throw new Error(`No element ${selector}`)
      return point
    },
    /**
     * Tap the first element matching selector: a click at its center, as a finger's tap becomes one. A mouse click,
     * since Chromium takes a touch tap within 300 ms of the last as half of a double tap, which clicks nothing.
     */
    async tap(selector) {
      const { x, y } = await page.center(selector)
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
    },
    /**
     * Drag a finger from one point to another in steps, about 16 ms apart, and lift it; then wait 400 ms, as a user
     * would before tapping: Chromium turns no tap into a click within 300 ms of a swipe's end.
     */
    async swipe(from, to, steps = 8) {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] })
      for (let i = 1; i <= steps; i++) {
        await delay(16)
        const point = { x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps }
        await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point] })
      }
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await delay(400)
    },
    /** Type text into the focused element, as a keyboard's input does. */
    async type(text) {
      await send('Input.insertText', { text })
    },
    /**
     * Press a letter key on a hardware keyboard, such as `F` with `KeyF`, with modifiers: Alt 1, Ctrl 2, Meta 4, Shift 8.
     * It types no character, as one held with Alt or Ctrl does not.
     */
    async press(key, code, modifiers) {
      const windowsVirtualKeyCode = code.charCodeAt(3)
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, modifiers, windowsVirtualKeyCode })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers, windowsVirtualKeyCode })
    }
  }
  return page
}

/** Read a folder's Markdown and text files into a mock setup, for trying the app on real notes. */
function read_folder(folder) {
  const files = {}
  const walk = directory => {
    for (const name of readdirSync(directory)) {
      if (name.startsWith('.') || name === 'node_modules') continue
      const path = join(directory, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (statSync(path).size < 2_000_000) files[relative(folder, path)] = readFileSync(path, 'utf8')
    }
  }
  walk(folder)
  return files
}

// Run as a script: serve a folder's notes for a desktop browser (open the printed URL with mobile emulation).
if (process.argv[1] === import.meta.filename) {
  const folder = process.argv[2]
  if (!folder) {
    console.error('Usage: node tests/browser.mjs <notes folder>')
    process.exit(1)
  }
  const server = await start_server({ files: read_folder(folder) })
  console.log(`${server.origin}/app/index.html`)
}
