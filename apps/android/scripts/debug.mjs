/** Build and launch the debug APK, starting an installed emulator when needed, then expose its WebView to VS Code. */
import { execFile, spawn } from 'node:child_process'
import { mkdirSync, openSync, closeSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

/** Resolve all tools from the same SDK; this machine keeps its virtual devices alongside it. */
const app_dir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sdk = process.env.ANDROID_HOME || join(homedir(), 'Android')
const env = { ...process.env, ANDROID_HOME: sdk, ANDROID_AVD_HOME: process.env.ANDROID_AVD_HOME || join(sdk, 'avd') }
// Gradle rejects conflicting SDK variables; ANDROID_HOME is the supported one.
delete env.ANDROID_SDK_ROOT
const adb_path = join(sdk, 'platform-tools', 'adb')
const execute = promisify(execFile)
/** The debug build has the same application id as the app; reinstalling preserves its notes-folder permission and settings. */
const application = 'opensource.txret.srmd'
const port = 9223

/** Run adb with a bounded wait and return its trimmed standard output. */
async function adb(...args) {
  const { stdout } = await execute(adb_path, args, { env, timeout: 30_000 })
  return stdout.trim()
}

/** Poll until check returns a truthy result, or report which startup step timed out. */
async function wait_for(description, check, timeout = 180_000) {
  /* Give the device time to boot without leaving a failed launch waiting forever. */
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const result = await check()
    if (result) return result
    await delay(500)
  }
  throw new Error(`Timed out waiting for ${description}`)
}

/** List connected device serials, including devices still booting. */
async function devices() {
  const listing = await adb('devices')
  return listing.split(/\r?\n/).slice(1).filter(line => line.trim()).map(line => line.split(/\s+/)[0])
}

/** Start the requested AVD independently of the debug task, retaining its output for startup failures. */
async function start_emulator() {
  /* Keep the emulator alive after the debugger detaches, and keep its diagnostics out of the build output. */
  const log_dir = join(app_dir, 'build')
  mkdirSync(log_dir, { recursive: true })
  const log_path = join(log_dir, 'emulator.log')
  const log = openSync(log_path, 'a')
  const name = process.env.SRMD_ANDROID_AVD || 'pixel_test'
  console.log(`Starting ${name}; emulator output: ${log_path}`)
  const child = spawn(join(sdk, 'emulator', 'emulator'), ['-avd', name], {
    env, detached: true, stdio: ['ignore', log, log]
  })
  closeSync(log)
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })
  child.unref()
}

/** Build the web assets and APK with the selected SDK, showing the build output and reporting failure. */
async function build() {
  /* Use the same npm build as packaging, so the installed code and local source maps agree. */
  const child = spawn('npm', ['run', 'apk'], { cwd: app_dir, env, stdio: 'inherit' })
  await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Android build exited with ${code}`)))
  })
}

/** Build, choose one device, install and launch the app, then wait for its forwarded debugging endpoint. */
async function main() {
  /*
   * 1. Build with the existing SDK and reuse a connected device, or start the configured AVD.
   * 2. Wait for Android, reinstall without clearing app data, and start the activity.
   * 3. Forward this process's WebView socket and finish only when the debugger can see its page.
   */
  await build()
  const connected = await devices()
  if (!env.ANDROID_SERIAL && connected.length > 1) throw new Error('Multiple Android devices are connected; set ANDROID_SERIAL to choose one')
  if (!connected.length && !env.ANDROID_SERIAL) await start_emulator()
  const serial = env.ANDROID_SERIAL || connected[0] || await wait_for('the emulator to connect (see build/emulator.log)', async () => (await devices())[0])
  await wait_for(`Android to finish booting on ${serial}`, async () => {
    /* An emulator appears in adb before its shell is ready. */
    try {
      return await adb('-s', serial, 'shell', 'getprop', 'sys.boot_completed') === '1'
    } catch {
      return false
    }
  })

  console.log(`Installing srmd on ${serial}`)
  console.log(await adb('-s', serial, 'install', '-r', join(app_dir, 'native/app/build/outputs/apk/debug/app-debug.apk')))
  console.log(await adb('-s', serial, 'shell', 'am', 'start', '-S', '-W', '-n', `${application}/.MainActivity`))
  const pid = await adb('-s', serial, 'shell', 'pidof', '-s', application)
  const socket = `webview_devtools_remote_${pid}`
  await wait_for('the app WebView debugging socket', async () => (await adb('-s', serial, 'shell', 'cat', '/proc/net/unix')).includes(`@${socket}`), 30_000)
  await adb('-s', serial, 'forward', `tcp:${port}`, `localabstract:${socket}`)
  await wait_for('the srmd debug page', async () => {
    /* A live socket may precede the page; transient connection failures are retried during this short wait. */
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) })
      const targets = await response.json()
      return targets.some(target => target.url === 'https://appassets.androidplatform.net/app/index.html')
    } catch {
      return false
    }
  }, 30_000)
  console.log(`srmd WebView ready at 127.0.0.1:${port}; attach the VS Code Android WebView debugger`)
}

main().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
