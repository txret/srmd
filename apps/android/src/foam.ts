/**
 * Foam for the notes folder (ARCHITECTURE.md, "Android host"): Foam's workspace and parser over the folder's
 * Markdown files, the files the app opens as Markdown, notes included, and its attachments, and the markdown-it the app renders every file with, and shows and saves cards with,
 * Foam's preview pipeline (createFoamMarkdownIt()) with srmd's plugin as its extension; notes load with srmd's own.
 * Foam renders wiki links, embeds, tags and block anchors, srmd its clozes, in view and review mode alike.
 *
 * Foam's plugins render synchronously, while the app reads files through the shell. Foam knows every file by its name,
 * from the scans; before a file renders, prepare() reads and parses the files its wiki links and embeds point at, for
 * their titles, sections and blocks, and keeps their texts for Foam's embed plugin, which reads them with
 * readFileSync() (foam_fs.ts), a few levels of embeds deep. Parsing every file instead would take as long again as
 * loading the notes, so Foam's queries, which need every file's metadata, are left out of the build
 * (scripts/rollup_foam.mjs). Absolute paths, which Foam writes for wiki links and image embeds, are made the URLs the app serves
 * the folder at.
 *
 * An embedded file is not the note reviewed: Foam renders it through the instance createInnerMd() gives, which says so
 * in the parse's environment, so srmd shows its clozes with ordinal 0 and no card. srmd syntax applies to every file
 * the app renders, embedded or not, as plain Markdown files render with srmd too.
 */
import MarkdownIt from 'markdown-it'
import {
  AttachmentResourceProvider, FoamWorkspace, GenericDataStore, MarkdownResourceProvider, URI, createMarkdownParser,
  defaultAttachmentExtensions, type Resource
} from '@foam/core'
import { srmd_plugin } from '@srmd/parser'
import { createFoamMarkdownIt } from '#foam-preview'
import { texts } from './foam_fs'
import { NOTES_PATH } from './note_view'

/** How many levels of embeds below the file shown prepare() reads. */
const embed_depth = 3

/** A workspace path's Foam URI, below `/`, and back. */
const uri_of = (path: string): URI => URI.file('/' + path)
const path_of = (uri: URI): string => uri.path.slice(1)

/** Absolute paths, from the folder's root, under the URL the app serves the folder at, as markdown-it normalizes them. */
function notes_links(md: MarkdownIt): void {
  const normalize = md.normalizeLink.bind(md)
  md.normalizeLink = url => normalize(url.startsWith('/') && !url.startsWith('//') ? NOTES_PATH + url.slice(1) : url)
}

/** Foam over the notes folder, and the markdown-it it composes (see the module comment). */
export class Foam {
  /** The instance every file renders with, and cards are shown and saved with; notes load with srmd's own. */
  readonly md: MarkdownIt
  private readonly workspace = new FoamWorkspace([URI.file('/')], '.md')
  private readonly parser = createMarkdownParser()
  /** Foam's attachments, such as images, as Foam knows them. */
  private readonly attachments = new AttachmentResourceProvider(defaultAttachmentExtensions)
  /** The paths of the files Foam knows; those whose texts embeds read (foam_fs.ts) were read and parsed since they last changed. */
  private known = new Set<string>()
  /** The file shown last, which `$current` and embeds of its own sections refer to. */
  private shown: string | null = null

  /**
   * @param read - A file's current text.
   * @param is_markdown - Whether the app opens the file at path as Markdown, a note included: Foam's notes.
   */
  constructor(private readonly read: (path: string) => Promise<string>, private readonly is_markdown: (path: string) => boolean) {
    /*
     * 1. Foam's workspace over a store listing the files Foam knows and reading them with read(); nothing writes
     *    through it. Foam's Markdown provider, which resolves its notes' links, takes the app's Markdown files for its
     *    own, whatever their extension.
     * 2. Foam's pipeline on srmd's options, srmd's plugin with the positions saving needs last, and the folder's URLs.
     *    Embeds render through an instance that marks its parses embedded.
     */
    const store = new GenericDataStore(async () => [...this.known].map(uri_of), uri => this.read(path_of(uri)))
    const markdown = new MarkdownResourceProvider(store, this.parser)
    markdown.supports = uri => this.is_markdown(path_of(uri))
    this.workspace.registerProvider(markdown)
    this.workspace.registerProvider(this.attachments)

    // Step 2: the pipeline, on srmd's options, without linking names without a scheme, as VS Code's preview: `c.sr` in
    // `![[c.sr]]` would become a link before Foam's rules find the embed.
    const base = new MarkdownIt({ html: true, linkify: true, xhtmlOut: true })
    base.linkify.set({ fuzzyLink: false })
    const md: MarkdownIt = createFoamMarkdownIt({
      workspace: this.workspace,
      parser: this.parser,
      linkResolver: ({ resource, linkFragment }) => ({ href: NOTES_PATH + path_of(resource.uri) + linkFragment }),
      getCurrentResource: () => this.shown === null ? null : this.workspace.find(uri_of(this.shown)) ?? null,
      createInnerMd: () => embedded,
      extensions: [md => srmd_plugin(md, { positions: true }), notes_links]
    }, base)
    /** The instance embedded files render with: the same, its parses marked embedded. */
    const embedded: MarkdownIt = Object.create(md)
    embedded.render = (src: string, env: object = {}): string => md.render(src, { ...env, srmd: { embedded: true } })
    this.md = md
  }

  /**
   * Know these files, the folder's Markdown files and attachments, and no others; other files are left out. A file
   * new to Foam, or a Markdown file whose text changed (changed), is known by its name until a shown file links to it.
   */
  async set_files(paths: Iterable<string>, changed: Iterable<string> = []): Promise<void> {
    /* Delete files gone, add new ones, then forget what was read of changed files, which their names replace. */
    const files = new Set<string>()
    for (const path of paths) {
      if (this.is_markdown(path) || this.attachments.supports(uri_of(path))) files.add(path)
    }
    for (const path of this.known) {
      if (files.has(path)) continue
      this.workspace.delete(uri_of(path))
      this.forget(path)
    }
    const stale = new Set(changed)
    for (const path of files) {
      if (this.known.has(path) && !stale.has(path)) continue
      this.forget(path)
      this.workspace.set(this.is_markdown(path) ? this.parser.parse(uri_of(path), '') : await this.attachments.fetch(uri_of(path)))
    }
    this.known = files
  }

  /**
   * Read and parse what rendering a file needs (see the module comment): the files its wiki links and embeds point at,
   * and theirs for embedded notes, embed_depth levels deep; files read before are not read again.
   * @param path - The file to render, which becomes the file shown.
   * @param text - Its current text.
   */
  async prepare(path: string, text: string): Promise<void> {
    /* Walk the links level by level, from the file's own resource, which also gives embeds of its own sections. */
    this.shown = path
    let level: Resource[] = [this.update(path, text)]
    for (let depth = 0; depth <= embed_depth && level.length; depth++) {
      const next: Resource[] = []
      for (const resource of level) {
        for (const link of resource.links) {
          if (link.type !== 'wikilink') continue
          const uri = this.workspace.resolveLink(resource, link)
          const target = uri.isPlaceholder() ? undefined : this.workspace.find(uri)
          const parsed = target?.type === 'note' ? await this.parse(path_of(target.uri)) : undefined
          if (parsed && link.isEmbed) next.push(parsed)
        }
      }
      level = next
    }
  }

  /** Read and parse a Markdown file Foam knows by name, unless it was since it last changed; unreadable, it keeps its name. */
  private async parse(path: string): Promise<Resource | undefined> {
    if (texts.has(uri_of(path).toFsPath())) return this.workspace.find(uri_of(path)) ?? undefined
    try {
      return this.update(path, await this.read(path))
    } catch {
      return undefined
    }
  }

  /**
   * Make text a Markdown file's current text: its resource, and for a file Foam knows, the resource in Foam's workspace
   * and the text embeds of the file read, which change together.
   */
  private update(path: string, text: string): Resource {
    const resource = this.parser.parse(uri_of(path), text)
    if (this.known.has(path)) {
      this.workspace.set(resource)
      texts.set(uri_of(path).toFsPath(), text)
    }
    return resource
  }

  /** Forget what was read of a file. */
  private forget(path: string): void {
    texts.delete(uri_of(path).toFsPath())
  }
}
