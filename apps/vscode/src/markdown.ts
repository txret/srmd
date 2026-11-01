import * as vscode from 'vscode'
import MarkdownIt from 'markdown-it'
import { m } from '@srmd/l10n'
import { error_text } from '@srmd/workspace'

/** What the activation of an extension contributing markdown-it plugins exports, as VS Code's preview reads it. */
interface Contributor {
  extendMarkdownIt?: (md: MarkdownIt) => MarkdownIt
}

/** The options VS Code's Markdown preview sets from the `markdown.preview.*` settings at every render. */
function preview_options(): { breaks: boolean; linkify: boolean; typographer: boolean } {
  const config = vscode.workspace.getConfiguration('markdown', vscode.workspace.workspaceFolders?.[0]?.uri ?? null)
  return {
    breaks: Boolean(config.get('preview.breaks', false)),
    linkify: Boolean(config.get('preview.linkify', true)),
    typographer: Boolean(config.get('preview.typographer', false))
  }
}

/** Whether a hook's result can stand for the instance: VS Code's preview passes it on as markdown-it. */
function is_markdown_it(value: unknown): value is MarkdownIt {
  return typeof (value as MarkdownIt | undefined)?.parse === 'function' && typeof (value as MarkdownIt).renderer?.render === 'function'
}

/**
 * The markdown-it instance reviews parse and render notes with, composed as VS Code composes its Markdown preview's,
 * so what other extensions add to the preview, such as Foam's wiki links and embeds, shows in reviews alongside srmd's
 * clozes, and the cards and saves come from that same parse:
 * 1. A dedicated instance with the options VS Code's preview starts from: HTML on and no links without a scheme.
 * 2. The installed extensions whose manifests declare `markdown.markdownItPlugins`, ordered by id, as VS Code promises
 *    no order and plugins' rules can depend on it.
 * 3. Each is activated, then its extendMarkdownIt() is called with the instance the previous one returned, srmd's
 *    own with `review: true`, which adds the source positions saving needs.
 * The instance is composed when the first review needs it, and again after extensions change. Each use applies the
 * preview's line break, link and typography settings, as the preview does at every render; VS Code's code highlighting
 * and its handling of front matter, links and images, which it adds to the preview after the extensions, are left out,
 * and srmd hides front matter itself. A contributor that fails to activate, or whose hook fails, is left out of the
 * instance, logged and announced.
 */
export class ReviewMarkdown implements vscode.Disposable {
  /** The composition of the current extensions, once a review asked for it; null before and after extensions change. */
  private composed: Promise<MarkdownIt> | null = null
  /** Drops the composition when extensions are installed, removed, enabled or disabled. */
  private readonly listener: vscode.Disposable

  /**
   * @param self - srmd's own extension id, whose plugin is own().
   * @param own - Add srmd's plugin for reviews to the instance; a failure fails the composition.
   * @param log - Receives each contributor's failure.
   */
  constructor(
    private readonly self: string, private readonly own: (md: MarkdownIt) => MarkdownIt,
    private readonly log: vscode.LogOutputChannel
  ) {
    this.listener = vscode.extensions.onDidChange(() => {
      this.composed = null
    })
  }

  /**
   * The instance, composed if no review asked for it since extensions last changed, with the preview's current
   * options. Rejects when srmd's own plugin fails; the next call composes again.
   */
  async get(): Promise<MarkdownIt> {
    /* Share one composition between concurrent calls; forget a failed one, unless extensions changed meanwhile. */
    const composed = this.composed ??= this.compose()
    try {
      const md = await composed
      md.set(preview_options())
      return md
    } catch (error: unknown) {
      if (this.composed === composed) this.composed = null
      throw error
    }
  }

  /** Stop following extension changes. */
  dispose(): void {
    this.listener.dispose()
  }

  /** Compose the instance (see the class comment). */
  private async compose(): Promise<MarkdownIt> {
    /*
     * 1. Create the instance and list the contributors in id order.
     * 2. Activate the other contributors together, then call the hooks one after another in that order, each with the
     *    previous one's result. A failure leaves that contributor out; whatever its hook changed before failing stays.
     * 3. Log the failures and announce them once.
     */
    let md = new MarkdownIt({ html: true })
    md.linkify.set({ fuzzyLink: false })
    const contributors = vscode.extensions.all
      .filter(extension => extension.packageJSON?.contributes?.['markdown.markdownItPlugins'])
      .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    const activations = await Promise.allSettled(contributors.map(extension => extension.id === this.self ? undefined : extension.activate()))
    /** One log line for each contributor left out. */
    const failures: string[] = []
    for (const [index, extension] of contributors.entries()) {
      if (extension.id === this.self) {
        md = this.own(md)
        continue
      }
      const activation = activations[index]
      if (activation.status === 'rejected') {
        failures.push(m.vscode_markdown_activation_failed({ id: extension.id, detail: error_text(activation.reason) }))
        continue
      }
      // As in VS Code's preview, a contributor exporting no hook adds nothing.
      const exports = activation.value as Contributor | undefined
      if (typeof exports?.extendMarkdownIt !== 'function') continue
      try {
        const result: unknown = exports.extendMarkdownIt(md)
        if (is_markdown_it(result)) md = result
        else failures.push(m.vscode_markdown_plugin_failed({ id: extension.id, detail: m.vscode_markdown_no_instance() }))
      } catch (error: unknown) {
        failures.push(m.vscode_markdown_plugin_failed({ id: extension.id, detail: error_text(error) }))
      }
    }

    // Step 3: report.
    for (const failure of failures) this.log.error(failure)
    if (failures.length) {
      void vscode.window.showWarningMessage(m.vscode_markdown_plugins_failed({ count: failures.length }), m.vscode_show_log()).then(choice => {
        if (choice) this.log.show()
      })
    }
    return md
  }
}
