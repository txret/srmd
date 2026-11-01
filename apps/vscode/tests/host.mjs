// The VS Code API mock the host tests run the extension's production bundle in: a workspace of in-memory files,
// commands, views, notifications and review tabs whose documents run the reviewer bundle (see webview.cjs).
import assert from 'node:assert/strict'
import Module, { createRequire } from 'node:module'
import { posix as path } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { open_webview } from './webview.cjs'

const require = createRequire(import.meta.url)

/** A shared prototype lets complete tree rows, including their URIs, compare with deepEqual. */
class Uri {
  constructor(path) { this.path = path }
  toString() { return `file://${this.path}` }
}
export const uri = value => new Uri(value)
/**
 * VS Code reports a missing path with the code `FileNotFound`, and a path below a file with `FileNotADirectory`;
 * other failures carry other codes.
 */
class FileSystemError extends Error {
  static FileNotFound() { return Object.assign(new FileSystemError('File not found'), { code: 'FileNotFound' }) }
  static FileNotADirectory() { return Object.assign(new FileSystemError('Not a directory'), { code: 'FileNotADirectory' }) }
}
/** A theme color is identified by its id, like a theme icon. */
export class ThemeColor {
  constructor(id) { this.id = id }
}
/** Themed file and folder icons are static identities in VS Code too. */
export class ThemeIcon {
  static File = new ThemeIcon('file')
  static Folder = new ThemeIcon('folder')
  constructor(id) { this.id = id }
}
/** Editor positions are zero-based lines and characters; a selection or range keeps its two ends. */
export class Position {
  constructor(line, character) { Object.assign(this, { line, character }) }
}
export class Range {
  constructor(start, end) { Object.assign(this, { start, end }) }
}
export class Selection extends Range {}
/** An editor tab's input for a text file, which the extension recognizes by class. */
export class TabInputText {
  constructor(uri) { this.uri = uri }
}
class TreeItem {
  constructor(label, collapsibleState) {
    this.label = label
    this.collapsibleState = collapsibleState
  }
}
/**
 * Complete expected view rows for [due, new, later] counts. The label is the path's last segment, the inline
 * description abbreviates the counts, and the context value selects the row's buttons. Rows carry no command, so
 * clicking one opens nothing, and set no tooltip: the Explorer decoration's tooltip applies to rows with a resource URI.
 */
export const folder_row = (path, [due, fresh, later], warning = '') => ({
  label: path.split('/').pop(), collapsibleState: 1, id: `file:///workspace/${path}`, resourceUri: uri(`/workspace/${path}`),
  iconPath: ThemeIcon.Folder, description: `${warning}d${due} • n${fresh} • l${later}`, contextValue: 'folder'
})
export const note_row = (path, [due, fresh, later], warning = '') => ({
  label: path.split('/').pop(), collapsibleState: 0, id: `file:///workspace/${path}`, resourceUri: uri(`/workspace/${path}`),
  iconPath: ThemeIcon.File, description: `${warning}d${due} • n${fresh} • l${later}`, contextValue: 'note'
})
/** The open folder's row starts expanded and is named after the workspace folder. */
export const root_row = ([due, fresh, later], warning = '') => ({
  label: 'workspace', collapsibleState: 2, id: 'file:///workspace', resourceUri: uri('/workspace'),
  iconPath: ThemeIcon.Folder, description: `${warning}d${due} • n${fresh} • l${later}`, contextValue: 'folder'
})
/**
 * Whether changing srmd settings, by key without the `srmd.` prefix, affects a configuration section, as VS Code
 * reports it: the section is a changed setting or contains one, as `srmd.inactive` contains `srmd.inactive.front`.
 */
const affects = (keys, section) => keys.some(key => `srmd.${key}` === section || `srmd.${key}`.startsWith(`${section}.`))
const events = () => {
  const listeners = new Set()
  return {
    event(callback, receiver, disposables) {
      listeners.add(callback)
      const disposable = { dispose: () => listeners.delete(callback) }
      disposables?.push(disposable)
      return disposable
    },
    /** Deliver only to listeners still registered when their callback is reached. */
    fire(value) {
      /* Disposing another subscription during delivery prevents that listener from running. */
      for (const callback of [...listeners]) if (listeners.has(callback)) callback(value)
    },
    dispose() { listeners.clear() }
  }
}
/**
 * Another installed extension whose manifest declares `markdown.markdownItPlugins`, for start_host(): activated, it
 * exports extendMarkdownIt(md), which runs plugin(md) and returns its result, or md when plugin returns nothing. With an
 * activation error, activating it rejects with that error instead.
 */
export const markdown_extension = (id, plugin, activation_error) => ({ id, plugin, activation_error })

/** Wait until predicate holds, checking every 5 ms for a second; the test fails if it never does. */
export const wait_until = async predicate => {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return
    await delay(5)
  }
  assert.fail('Timed out waiting for the extension')
}

/**
 * Activate the extension's production bundle in a mocked VS Code holding one workspace folder, `/workspace`, and
 * return the host: its files, log, notifications, views, commands and the review tab it last opened, with methods
 * acting as the user or VS Code would. Only VS Code plumbing is shared; each test supplies its notes.
 * @param t - The test, whose end disposes the extension.
 * @param source - The text of topic/a.sr.md, or note texts by workspace-relative path.
 * @param settings - srmd settings by key without the `srmd.` prefix, and other sections' settings by their full key,
 *   such as `markdown.preview.breaks`; srmd is on unless they turn it off.
 * @param language - VS Code's display language.
 * @param extensions - The other extensions installed that contribute markdown-it plugins, from markdown_extension().
 */
export const start_host = async (t, source, settings, language = 'en', extensions = []) => {
  /* Fix nonce generation as well as due-day tie breaking so full HTML remains deterministic. */
  t.mock.method(Math, 'random', () => 0)
  settings = { enabled: true, ...settings }
  const sources = typeof source === 'string' ? { 'topic/a.sr.md': source } : source
  const files = new Map(Object.entries(sources).map(([name, text]) => [`/workspace/${name}`, { text, mtime: 1 }]))
  const commands = new Map()
  /** Published context keys drive native Explorer menu visibility. */
  const contexts = new Map()
  const changes = events()
  const edits = events()
  const deletions = events()
  const workspaces = events()
  const configuration = events()
  const decoration_changes = []
  /** View refresh events, and the title of every review panel opened in order. */
  const tree_changes = []
  const panels = []
  /** The ids of the other extensions in the order they were activated, each once, as VS Code activates them. */
  const activations = []
  /** srmd itself as VS Code lists it, with its manifest, already active. */
  const self = { id: 'srmd.srmd', packageJSON: require('../package.json'), isActive: true }
  /** An installed extension as VS Code lists it, from a markdown_extension() description. */
  const installed = ({ id, plugin, activation_error }) => {
    const extension = {
      id, packageJSON: { contributes: { 'markdown.markdownItPlugins': true } }, isActive: false, exports: undefined,
      async activate() {
        /* Activating an active extension again resolves with its exports at once. */
        if (extension.isActive) return extension.exports
        activations.push(id)
        if (activation_error) throw activation_error
        extension.isActive = true
        extension.exports = { extendMarkdownIt: md => plugin(md) ?? md }
        return extension.exports
      }
    }
    return extension
  }
  /** Every extension VS Code lists, srmd last, as VS Code lists them in no particular order. */
  const all_extensions = [...extensions.map(installed), self]
  const extension_changes = events()
  const context = { subscriptions: [], extensionUri: uri('/extension'), extension: self }
  let provider
  let tree
  let panel
  /** The srmd view as the extension created it: its selection, visibility and reveal(). */
  let view
  const visibility = events()
  /** Rows the extension selected in the view, as [path, options], and resources revealed in the Explorer. */
  const tree_reveals = []
  const explorer_reveals = []
  /** The active text editor and its changes; editors the extension opened, as { path, options, editor }. */
  let active_editor
  const active_editors = events()
  const opened = []
  /** Editor groups with their tabs, as VS Code's tabGroups.all lists them. */
  let tab_groups = []
  /** The quick pick the extension showed last, with helpers that type and accept like the user. */
  let quick_pick
  let watcher_disposed = false
  let decorations_disposed = false
  let tree_disposed = false
  let hold_write = null
  let writing = false
  /** Resolvers of reads waiting for the test while reads are paused; null when reads complete at once. */
  let held_reads = null
  /** Save errors and posted ratings let tests observe the complete webview-to-filesystem path. */
  const errors = []
  const messages = []
  /** Entries written to the srmd log output channel, as [level, message]; ['show'] when it was revealed. */
  const log = []
  /** Warning notifications as [message, ...actions], and the action each one resolves with (undefined: dismissed). */
  const warnings = []
  let warning_choice
  /** Information notifications, and settings the extension wrote as [key, value, target]. */
  const infos = []
  const config_updates = []
  /** File searches started, and file watchers created but not yet disposed: neither may happen while srmd is off. */
  let searches = 0
  let watchers = 0
  /** The extension's status bar item, as VS Code would show it. */
  let status
  let write_error = null
  /** The error file searches fail with, as fail_searches() sets it; null while they succeed. */
  let search_error = null
  /** How often the extension asked VS Code to redraw open Markdown previews. */
  let preview_refreshes = 0
  const mock = {
    Uri: {
      parse: value => uri(new URL(value).pathname),
      joinPath: (base, ...parts) => uri(path.join(base.path, ...parts))
    },
    RelativePattern: class { constructor(base, pattern) { Object.assign(this, { base, pattern }) } },
    FileSystemError,
    TreeItem,
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    Position,
    Range,
    Selection,
    TabInputText,
    TextEditorRevealType: { InCenterIfOutsideViewport: 2 },
    ThemeIcon,
    ThemeColor,
    FileType: { File: 1, Directory: 2 },
    EventEmitter: class { constructor() { Object.assign(this, events()) } },
    ProgressLocation: { Notification: 15 },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ViewColumn: { Active: -1, Beside: -2 },
    env: { language },
    /** srmd and the other installed extensions; installing one reports a change. */
    extensions: {
      get all() { return all_extensions },
      onDidChange: extension_changes.event
    },
    workspace: {
      workspaceFolders: [{ uri: uri('/workspace'), name: 'workspace' }],
      /** srmd's section, whose settings can be written, or another's, such as `markdown`, read by full key. */
      getConfiguration: section => section !== 'srmd' ? { get: (key, fallback) => settings[`${section}.${key}`] ?? fallback } : ({
        get: (key, fallback) => settings[key] ?? fallback,
        /** Write a setting and report the change, as VS Code does once the settings file is saved. */
        update: async (key, value, target) => {
          config_updates.push([key, value, target])
          settings[key] = value
          configuration.fire({ affectsConfiguration: section => affects([key], section) })
        }
      }),
      onDidChangeWorkspaceFolders: workspaces.event,
      onDidChangeConfiguration: configuration.event,
      asRelativePath: value => value.path === '/workspace' ? value.path : path.relative('/workspace', value.path),
      /** Files below the pattern's base folder ending in one of the endings its glob lists in braces, such as {.sr.md,.md}. */
      findFiles: async ({ base, pattern }) => {
        searches++
        if (search_error) throw search_error
        const endings = /\{([^}]*)\}$/.exec(pattern)[1].split(',')
        return [...files.keys()]
          .filter(name => name.startsWith(`${base.path}/`) && endings.some(ending => name.toLowerCase().endsWith(ending)))
          .map(uri)
      },
      /** Watchers share the test's event sources; each subscribes only to the kinds it does not ignore. */
      createFileSystemWatcher: (pattern, ignore_create, ignore_change, ignore_delete) => {
        watchers++
        return {
          onDidCreate: ignore_create ? () => ({ dispose() {} }) : changes.event,
          onDidChange: ignore_change ? () => ({ dispose() {} }) : edits.event,
          onDidDelete: ignore_delete ? () => ({ dispose() {} }) : deletions.event,
          dispose() {
            watcher_disposed = true
            watchers--
          }
        }
      },
      fs: {
        /** A known file (File | SymbolicLink for a link), or a folder when files exist below the path. */
        stat: async value => {
          /* A path below a file fails differently from a missing one, as ENOTDIR does on disk. */
          const file = files.get(value.path)
          if (file) return { type: file.symlink ? 1 | 64 : 1, mtime: file.mtime }
          if ([...files.keys()].some(name => name.startsWith(`${value.path}/`))) return { type: 2, mtime: 1 }
          for (let folder = path.dirname(value.path); folder !== '/'; folder = path.dirname(folder)) {
            if (files.has(folder)) throw FileSystemError.FileNotADirectory()
          }
          throw FileSystemError.FileNotFound()
        },
        readFile: async value => {
          /* Capture the content when the read starts; a paused read completes when the test releases it. */
          const file = files.get(value.path)
          if (!file) throw FileSystemError.FileNotFound()
          if (held_reads) await new Promise(resolve => held_reads.push(resolve))
          return Buffer.from(file.text)
        },
        writeFile: async (value, data) => {
          writing = true
          if (hold_write) await hold_write
          if (write_error) {
            writing = false
            throw write_error
          }
          files.set(value.path, {
            text: Buffer.from(data).toString(), mtime: (files.get(value.path)?.mtime ?? 0) + 1
          })
          writing = false
        }
      }
    },
    commands: {
      executeCommand: async (command, key, value) => {
        /* Capture Explorer menu membership, the resources the Explorer is asked to reveal, and preview redraws. */
        if (command === 'revealInExplorer') {
          explorer_reveals.push(key.path)
          return
        }
        if (command === 'markdown.preview.refresh') {
          preview_refreshes++
          return
        }
        assert.equal(command, 'setContext')
        contexts.set(key, value)
      },
      registerCommand: (name, callback) => {
        commands.set(name, callback)
        return { dispose() {} }
      }
    },
    window: {
      createOutputChannel: (name, options) => {
        /* The extension logs through one LogOutputChannel; record its entries by level. */
        assert.deepEqual([name, options], ['srmd', { log: true }])
        const entry = level => message => log.push([level, message])
        return { info: entry('info'), warn: entry('warn'), error: entry('error'), show: () => log.push(['show']), dispose() {} }
      },
      registerFileDecorationProvider: value => {
        /* Record invalidations without requesting children, just like a collapsed Explorer folder. */
        provider = value
        const subscription = provider.onDidChangeFileDecorations(value => decoration_changes.push(value))
        return { dispose() { subscription.dispose(); decorations_disposed = true } }
      },
      createTreeView: (id, options) => {
        /* Record refreshes without requesting rows, just like a collapsed view; record the rows the extension selects. */
        assert.equal(id, 'srmd.notes')
        tree = options.treeDataProvider
        const subscription = tree.onDidChangeTreeData(value => tree_changes.push(value))
        view = {
          selection: [],
          visible: true,
          onDidChangeVisibility: visibility.event,
          reveal: async (node, options) => { tree_reveals.push([node.path, options]) },
          dispose() { subscription.dispose(); tree_disposed = true }
        }
        return view
      },
      /** A quick pick: its rows and options as the extension gave them, closed by the test accepting a row or hiding it. */
      showQuickPick: (items, options) => new Promise(resolve => {
        quick_pick = {
          items, options, shown: true,
          accept(index) { this.shown = false; resolve(items[index]) },
          hide() { this.shown = false; resolve(undefined) }
        }
      }),
      get activeTextEditor() { return active_editor },
      onDidChangeActiveTextEditor: active_editors.event,
      tabGroups: { get all() { return tab_groups } },
      /** Open a workspace file in an editor; its document locates offsets in the file's text, as VS Code's does. */
      showTextDocument: async (value, options) => {
        /* Count lines up to the offset; tests use LF notes, so a line ends at each \n. */
        const text = files.get(value.path).text
        const editor = {
          document: {
            uri: value,
            positionAt: offset => {
              const lines = text.slice(0, offset).split('\n')
              return new Position(lines.length - 1, lines.at(-1).length)
            }
          },
          selection: null,
          revealRange(range, type) { this.revealed = [range, type] }
        }
        opened.push({ path: value.path, options, editor })
        return editor
      },
      withProgress: async (options, callback) => callback(),
      showInformationMessage: async message => { infos.push(message) },
      /** One item: its fields as set by the extension, and whether it is shown. */
      createStatusBarItem: (id, alignment, priority) => {
        assert.deepEqual([id, alignment, priority], ['srmd.status', 2, 100])
        status = { visible: false, show() { this.visible = true }, hide() { this.visible = false }, dispose() {} }
        return status
      },
      showWarningMessage: async (message, ...actions) => {
        warnings.push([message, ...actions])
        return warning_choice
      },
      showErrorMessage: message => errors.push(message),
      createWebviewPanel: (view_type, title) => {
        panels.push(title)
        const close = events()
        const receive = events()
        let disposed = false
        let html = ''
        let document
        /** Card messages the extension sent to this tab, in order. */
        const cards = []
        panel = {
          /** VS Code shows the title on the tab and lets the host change it; reveal() brings the tab forward. */
          title,
          reveals: 0,
          reveal() { this.reveals++ },
          webview: {
            asWebviewUri: value => ({ toString: () => `https://resources.test${value.path}` }),
            cspSource: 'https://resources.test', onDidReceiveMessage: receive.event,
            get html() { return html },
            /** Load the tab's document, running its reviewer script with the actual VS Code adapter. */
            set html(value) {
              /* Replace the browser document and forward messages from its script. */
              html = value
              document = open_webview(value, message => {
                messages.push(message)
                receive.fire(message)
              })
            },
            /** Deliver a message to the document after the current turn, like VS Code's asynchronous channel. */
            async postMessage(message) {
              /* Record cards, then dispatch a copy unless the tab has closed meanwhile. */
              if (message.type === 'card') cards.push(message)
              const copy = structuredClone(message)
              await null
              if (!disposed) document.deliver(copy)
              return !disposed
            }
          },
          onDidDispose: close.event,
          dispose() {
            if (disposed) return
            disposed = true
            close.fire()
          },
          cards,
          /** The card the document shows, replaced by every card message. */
          get document() { return document?.card },
          /** Layout observers the document's cards keep observing. */
          get document_observers() { return document?.observers },
          get disposed() { return disposed },
          reply: choice_id => document.card.choose(choice_id)
        }
        return panel
      }
    }
  }

  const original_load = Module._load
  Module._load = function (id, ...args) {
    return id === 'vscode' ? mock : original_load.call(this, id, ...args)
  }
  t.after(() => {
    panel?.dispose()
    for (const disposable of context.subscriptions) disposable.dispose()
    Module._load = original_load
  })
  // The production bundle, which the pretest build writes.
  const extension_path = require.resolve('../dist/extension.js')
  delete require.cache[extension_path]
  const extension = require(extension_path)
  Module._load = original_load
  const api = extension.activate(context)
  // Activation starts the load without waiting for it; the tests look at the loaded notes.
  await api.settled()
  return {
    /** The Markdown preview plugin activation exports; VS Code's preview passes it its markdown-it instance. */
    extend_markdown_it: md => api.extendMarkdownIt(md),
    activations,
    /** Install another extension contributing markdown-it plugins, which VS Code reports as a change of extensions. */
    install(extension) {
      all_extensions.unshift(installed(extension))
      extension_changes.fire()
    },
    get preview_refreshes() { return preview_refreshes },
    files,
    errors,
    messages,
    log,
    warnings,
    infos,
    config_updates,
    get searches() { return searches },
    get watchers() { return watchers },
    /** The status bar item's shown fields. */
    get status() {
      const { name, text, tooltip, command, visible } = status
      return { name, text, tooltip, command, visible }
    },
    /** Run a registered command, as the Command Palette or a status bar click does. */
    command: (name, ...args) => commands.get(name)(...args),
    /** Answer later warning notifications with this action. */
    answer_warnings(choice) { warning_choice = choice },
    state: tree.state,
    tree,
    /** Review a scope's URI, as the Explorer menu does; by default the open folder, which reviews the whole workspace. */
    review: (scope = uri('/workspace')) => commands.get('srmd.review')(scope),
    /** Run Review from the Command Palette, which passes no scope and asks for one. */
    palette_review: () => commands.get('srmd.review')(),
    get quick_pick() { return quick_pick },
    decoration: name => provider.provideFileDecoration(uri(name)),
    /** Complete rows VS Code receives for the root or for an expanded folder path. */
    rows: folder => tree.getChildren(folder === undefined ? undefined : tree.state.nodes[folder]).map(node => ({ ...tree.getTreeItem(node) })),
    /** Run a row button or menu item, which VS Code calls with that row. */
    review_row: path => commands.get('srmd.notes.review')(tree.state.nodes[path]),
    edit_row: path => commands.get('srmd.notes.edit')(tree.state.nodes[path]),
    reveal_row: path => commands.get('srmd.notes.reveal')(tree.state.nodes[path]),
    /** Select a row with the keyboard, then press Enter or Ctrl+Enter, whose bindings run without a row. */
    select(path) { view.selection = [tree.state.nodes[path]] },
    press_enter: () => commands.get('srmd.notes.review')(),
    press_ctrl_enter: () => commands.get('srmd.notes.edit')(),
    /** Make an editor for this file the active one, as switching tabs does; undefined leaves no text editor active. */
    activate_editor(name) {
      active_editor = name === undefined ? undefined : { document: { uri: uri(name) } }
      active_editors.fire(active_editor)
    },
    /** Show or hide the srmd view, as collapsing it or switching the side bar does. */
    set_view_visible(visible) {
      view.visible = visible
      visibility.fire({ visible })
    },
    set tab_groups(groups) { tab_groups = groups },
    tree_reveals,
    explorer_reveals,
    opened,
    contexts,
    decoration_changes,
    tree_changes,
    panels,
    get panel() { return panel },
    get writing() { return writing },
    get watcher_disposed() { return watcher_disposed },
    get decorations_disposed() { return decorations_disposed },
    get tree_disposed() { return tree_disposed },
    changes,
    edits,
    deletions,
    /** Change settings and report it, as VS Code does when the user edits them. */
    change_settings(changes) {
      Object.assign(settings, changes)
      configuration.fire({ affectsConfiguration: section => affects(Object.keys(changes), section) })
    },
    /** Add a second workspace folder and report the change, as VS Code does for a multi-root workspace. */
    add_folder(path, name) {
      mock.workspace.workspaceFolders = [...mock.workspace.workspaceFolders, { uri: uri(path), name }]
      workspaces.fire()
    },
    /** Report a workspace-folder change, such as an added second folder, keeping the first folder. */
    folders_changed() { workspaces.fire() },
    /** Hold every read that starts from now on; pending counts them and release() completes them all. */
    pause_reads() {
      held_reads = []
      return {
        get pending() { return held_reads?.length ?? 0 },
        release() {
          const resolvers = held_reads
          held_reads = null
          for (const resolve of resolvers) resolve()
        }
      }
    },
    close_workspace() {
      /* Remove the root and send the normal host workspace-change event. */
      mock.workspace.workspaceFolders = []
      workspaces.fire()
    },
    fail_writes: error => { write_error = error },
    fail_searches: error => { search_error = error },
    pause_writes() {
      let release
      hold_write = new Promise(resolve => { release = resolve })
      return () => { hold_write = null; release() }
    },
    dispose() { for (const disposable of context.subscriptions) disposable.dispose() }
  }
}
