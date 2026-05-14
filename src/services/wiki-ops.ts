import * as fs from 'node:fs'
import * as path from 'node:path'
import type { SearchMode, SearchResult, RelatedResult } from './search.service.js'
import type { LintIssue, LintRepair, ReindexResult } from './doc-workflow.service.js'
import type { ParsedDoc, DocFrontmatter, ParserService } from './parser.service.js'
import type { RemoteClient } from './remote-client.js'
import { RemoteError } from './remote-client.js'
import type { StorageService } from './storage.service.js'
import type { SearchService } from './search.service.js'
import type { IndexService } from './index.service.js'
import type { DocWorkflowService } from './doc-workflow.service.js'
import type { SchemaService } from './schema.service.js'
import type { ActivityLogService } from './activity-log.service.js'
import { slugify, toFilename, canonicalize, normalizeDocId, today } from '../utils/slug.js'

/**
 * Canonical shape every doc-writing entry point funnels through. CLI
 * `add`/`update`, HTTP POST/PUT, file-mode and content-mode all build one of
 * these and hand it to `addDoc` / `updateDoc`. Suppression fields
 * (`importantSections`, `suppressMergeWarn`, `suppressLint`) reach
 * `lintRawDoc` via this single path — there is no separate codepath that
 * could drop them.
 *
 * Semantics:
 * - `body` replaces the whole body (mutually exclusive with `appendBody`).
 * - `appendBody` appends to the existing body (update only — ignored on add).
 * - `undefined` on update means "leave existing value alone". On add,
 *   `title` and `category` are required at the wiki-ops boundary.
 */
export interface DocInput {
  title?: string
  category?: string
  tags?: string[]
  body?: string
  appendBody?: string
  importantSections?: string[]
  suppressMergeWarn?: string[]
  suppressLint?: string[]
}

/** Back-compat alias — UpdatePatch is now DocInput. */
export type UpdatePatch = DocInput

export interface WriteOpts {
  dryRun?: boolean
}

export interface DocEntry {
  id: string
  title: string
  category: string
  tags?: string[]
  filePath: string
}

export interface TocResult {
  categories: Record<string, { id: string; title: string; filePath: string }[]>
}

export interface ReadSliceResult {
  filename: string
  fromLine: number
  toLine: number
  totalLines: number
  content: string
}

export interface WikiInfo {
  name: string
  docCount: number
  sizeBytes: number
  lastUpdated: string | null
}

export interface WriteResult {
  id: string
  filename: string
  issues: LintIssue[]
}

export function formatDocNotFound(opts: {
  kb: string
  input: string
  id?: string
  filename?: string
  suggestions: string[]
}): string {
  const lines = [`Document not found in wiki "${opts.kb}": ${opts.input}`]
  if (opts.id && opts.id !== opts.input) lines.push(`  Canonical id: ${opts.id} (${opts.filename})`)
  if (opts.suggestions.length > 0) {
    lines.push(`  Did you mean:`)
    for (const s of opts.suggestions) lines.push(`    - ${s}`)
  }
  lines.push(`  Run \`kb list\` to see all docs, or \`kb resolve ${opts.input}\` for fuzzy-match details.`)
  return lines.join('\n')
}

export class InvalidDocInputError extends Error {
  name = 'InvalidDocInputError'
}

export class DocNotFoundError extends Error {
  name = 'DocNotFoundError'
  constructor(
    public kb: string,
    public input: string,
    public id: string,
    public filename: string,
    public suggestions: string[],
  ) {
    super(formatDocNotFound({ kb, input, id, filename, suggestions }))
  }
}

export interface ResolveResult {
  input: string
  id: string
  filename: string
  exists: boolean
  title?: string
  category?: string
  suggestions: string[]
}

export interface WikiOps {
  search(query: string, limit: number, mode: SearchMode): Promise<SearchResult[]>
  docExists(filename: string): Promise<boolean>
  readRaw(filename: string): Promise<string>
  readDoc(filename: string): Promise<ParsedDoc>
  readSlice(filename: string, fromLine: number, toLine: number): Promise<ReadSliceResult>
  addDoc(input: DocInput, opts?: WriteOpts): Promise<WriteResult>
  updateDoc(id: string, input: DocInput, opts?: WriteOpts): Promise<WriteResult>
  deleteDoc(id: string): Promise<{ deleted: string; warnings: string[] }>
  rename(oldId: string, newId: string): Promise<{ oldId: string; newId: string; linksUpdated: number }>
  listDocs(filters?: { category?: string; tag?: string }): Promise<DocEntry[]>
  categories(): Promise<string[]>
  related(id: string, limit: number): Promise<RelatedResult[]>
  lint(): Promise<LintIssue[]>
  lintFix(): Promise<{ fixed: number; repairs: LintRepair[] }>
  reindex(onProgress?: (current: number, total: number) => void): Promise<ReindexResult>
  reindexDoc(id: string): Promise<{ id: string; filename: string }>
  toc(): Promise<TocResult>
  log(limit: number): Promise<any[]>
  logAdd(op: string, doc?: string, details?: string): Promise<void>
  schema(): Promise<string | object | null>
  schemaUpdate(): Promise<void>
  info(): Promise<WikiInfo>
  resolve(input: string): Promise<ResolveResult>
}

export interface LocalServices {
  storage: StorageService
  search: SearchService
  index: IndexService
  workflow: DocWorkflowService
  schema: SchemaService
  activityLog: ActivityLogService
  parser: ParserService
}

export class LocalWikiOps implements WikiOps {
  constructor(private kb: string, private svc: LocalServices) {}

  private async fuzzySuggestions(id: string, limit = 5): Promise<string[]> {
    const lower = id.toLowerCase()
    const all = await this.svc.index.listDocs(this.kb)
    return all
      .map((d) => d.id)
      .filter((other) => other.toLowerCase().includes(lower) || lower.includes(other.toLowerCase()))
      .slice(0, limit)
  }

  private async assertExists(input: string, id: string, filename: string): Promise<void> {
    if (this.svc.storage.docExists(this.kb, filename)) return
    const suggestions = await this.fuzzySuggestions(id)
    throw new DocNotFoundError(this.kb, input, id, filename, suggestions)
  }

  async search(query: string, limit: number, mode: SearchMode): Promise<SearchResult[]> {
    return this.svc.search.search(this.kb, query, limit, mode)
  }

  async docExists(filename: string): Promise<boolean> {
    return this.svc.storage.docExists(this.kb, toFilename(normalizeDocId(filename)))
  }

  async readRaw(rawInput: string): Promise<string> {
    const { id, filename } = canonicalize(rawInput)
    await this.assertExists(rawInput, id, filename)
    return this.svc.storage.readRaw(this.kb, filename)
  }

  async readDoc(rawInput: string): Promise<ParsedDoc> {
    const { id, filename } = canonicalize(rawInput)
    await this.assertExists(rawInput, id, filename)
    return this.svc.storage.readDoc(this.kb, filename)
  }

  async readSlice(rawInput: string, fromLine: number, toLine: number): Promise<ReadSliceResult> {
    const { id, filename } = canonicalize(rawInput)
    await this.assertExists(rawInput, id, filename)
    return this.svc.storage.readSlice(this.kb, filename, fromLine, toLine)
  }

  async addDoc(input: DocInput, opts?: WriteOpts): Promise<WriteResult> {
    if (!input.title) throw new InvalidDocInputError('title is required for kb add (pass --title, or include it in the file frontmatter).')
    if (!input.category) throw new InvalidDocInputError('category is required for kb add (pass --category, or include it in the file frontmatter).')
    const id = slugify(input.title)
    const filename = `${id}.md`

    if (!opts?.dryRun && this.svc.storage.docExists(this.kb, filename)) {
      throw new Error(`Document "${filename}" already exists in wiki "${this.kb}".`)
    }

    const frontmatter = mergeFrontmatter({
      id,
      created: today(),
      updated: today(),
      title: input.title,
      category: input.category,
      tags: input.tags ?? [],
    }, input)

    const body = input.body ?? ''
    const raw = this.svc.parser.serialize(frontmatter, body)
    const issues = this.svc.workflow.lintRawDoc(raw, filename)

    if (opts?.dryRun) return { id, filename, issues }

    this.svc.storage.writeDoc(this.kb, filename, frontmatter, body)
    await this.svc.workflow.indexAndEmbed(this.kb, id, frontmatter)
    this.svc.activityLog.log(this.kb, 'add', id, `category=${input.category}`)

    return { id, filename, issues }
  }

  async updateDoc(rawId: string, input: DocInput, opts?: WriteOpts): Promise<WriteResult> {
    const { id, filename } = canonicalize(rawId)
    await this.assertExists(rawId, id, filename)

    const doc = this.svc.storage.readDoc(this.kb, filename)
    const frontmatter = mergeFrontmatter({ ...doc.frontmatter, updated: today() }, input)

    let body = doc.body
    if (input.body !== undefined) body = input.body
    else if (input.appendBody !== undefined) body = body + input.appendBody

    const raw = this.svc.parser.serialize(frontmatter, body)
    const issues = this.svc.workflow.lintRawDoc(raw, filename)

    if (opts?.dryRun) return { id, filename, issues }

    this.svc.storage.writeDoc(this.kb, filename, frontmatter, body)
    await this.svc.workflow.indexAndEmbed(this.kb, id, frontmatter)
    this.svc.activityLog.log(this.kb, 'update', id)

    return { id, filename, issues }
  }

  async deleteDoc(rawId: string): Promise<{ deleted: string; warnings: string[] }> {
    const { id, filename } = canonicalize(rawId)
    await this.assertExists(rawId, id, filename)

    const backlinks = await this.svc.index.getLinksTo(this.kb, id)
    const warnings: string[] = []
    if (backlinks.length > 0) {
      const sources = backlinks.map((l) => toFilename(l.fromId))
      warnings.push(
        `${backlinks.length} document(s) have broken links to ${filename}: ${sources.join(', ')}`,
      )
    }

    this.svc.storage.deleteDoc(this.kb, filename)
    await this.svc.workflow.removeFromIndex(this.kb, id)
    this.svc.activityLog.log(this.kb, 'delete', id)

    return { deleted: filename, warnings }
  }

  async rename(rawOldId: string, rawNewId: string): Promise<{ oldId: string; newId: string; linksUpdated: number }> {
    const { id: oldId, filename: oldFilename } = canonicalize(rawOldId)
    const { id: newId, filename: newFilename } = canonicalize(rawNewId)

    await this.assertExists(rawOldId, oldId, oldFilename)

    if (this.svc.storage.docExists(this.kb, newFilename)) {
      throw new Error(`Document "${newFilename}" already exists in wiki "${this.kb}".`)
    }

    const linksUpdated = await this.svc.workflow.rename(this.kb, oldId, newId, oldFilename, newFilename)
    this.svc.activityLog.log(this.kb, 'rename', newId, `from=${oldId}`)
    return { oldId, newId, linksUpdated }
  }

  async listDocs(filters?: { category?: string; tag?: string }): Promise<DocEntry[]> {
    const docs = await this.svc.index.listDocs(this.kb, filters)
    return docs.map((d) => ({
      id: d.id,
      title: d.title,
      category: d.category,
      tags: d.tags,
      filePath: d.filePath,
    }))
  }

  async categories(): Promise<string[]> {
    const docs = await this.svc.index.listDocs(this.kb)
    return [...new Set(docs.map((d) => d.category).filter(Boolean))].sort()
  }

  async related(rawId: string, limit: number): Promise<RelatedResult[]> {
    const { id, filename } = canonicalize(rawId)
    await this.assertExists(rawId, id, filename)
    const scored = await this.svc.workflow.findRelated(this.kb, id, filename, limit)
    return this.svc.search.buildRelatedResults(this.kb, scored)
  }

  async lint(): Promise<LintIssue[]> {
    return this.svc.workflow.lint(this.kb)
  }

  async lintFix(): Promise<{ fixed: number; repairs: LintRepair[] }> {
    const issues = await this.svc.workflow.lint(this.kb)
    const repairs = await this.svc.workflow.lintFix(this.kb, issues)
    return { fixed: repairs.length, repairs }
  }

  async reindex(onProgress?: (current: number, total: number) => void): Promise<ReindexResult> {
    return this.svc.workflow.reindex(this.kb, onProgress)
  }

  async reindexDoc(rawId: string): Promise<{ id: string; filename: string }> {
    const { id, filename } = canonicalize(rawId)
    await this.assertExists(rawId, id, filename)
    const doc = this.svc.storage.readDoc(this.kb, filename)
    await this.svc.workflow.indexAndEmbed(this.kb, id, doc.frontmatter)
    this.svc.activityLog.log(this.kb, 'reindex', id)
    return { id, filename }
  }

  async toc(): Promise<TocResult> {
    const docs = await this.svc.index.listDocs(this.kb)
    const categories: Record<string, { id: string; title: string; filePath: string }[]> = {}
    for (const doc of docs) {
      const cat = doc.category || 'uncategorized'
      if (!categories[cat]) categories[cat] = []
      categories[cat].push({ id: doc.id, title: doc.title, filePath: doc.filePath })
    }
    return { categories }
  }

  async log(limit: number): Promise<any[]> {
    return this.svc.activityLog.recent(this.kb, limit)
  }

  async logAdd(op: string, doc?: string, details?: string): Promise<void> {
    this.svc.activityLog.log(this.kb, op, doc, details)
  }

  async schema(): Promise<string | null> {
    return this.svc.schema.read(this.kb)
  }

  async schemaUpdate(): Promise<void> {
    await this.svc.schema.update(this.kb)
  }

  async info(): Promise<WikiInfo> {
    const docsDir = this.svc.storage.getDocsDir(this.kb)
    if (!fs.existsSync(docsDir)) {
      return { name: this.kb, docCount: 0, sizeBytes: 0, lastUpdated: null }
    }
    const files = fs.readdirSync(docsDir).filter((f) => f.endsWith('.md'))
    let sizeBytes = 0
    let lastMs = 0
    for (const f of files) {
      const stat = fs.statSync(path.join(docsDir, f))
      sizeBytes += stat.size
      if (stat.mtimeMs > lastMs) lastMs = stat.mtimeMs
    }
    return {
      name: this.kb,
      docCount: files.length,
      sizeBytes,
      lastUpdated: lastMs ? new Date(lastMs).toISOString() : null,
    }
  }

  async resolve(input: string): Promise<ResolveResult> {
    const { id, filename } = canonicalize(input)
    const exists = id !== '' && this.svc.storage.docExists(this.kb, filename)
    let title: string | undefined
    let category: string | undefined
    if (exists) {
      try {
        const doc = this.svc.storage.readDoc(this.kb, filename)
        title = doc.frontmatter.title
        category = doc.frontmatter.category
      } catch {}
    }
    const suggestions = !exists && id !== '' ? await this.fuzzySuggestions(id) : []
    return { input, id, filename, exists, title, category, suggestions }
  }
}

export class RemoteWikiOps implements WikiOps {
  constructor(
    private url: string,
    private wiki: string,
    private secret: string | undefined,
    private client: RemoteClient,
  ) {}

  async search(query: string, limit: number, mode: SearchMode): Promise<SearchResult[]> {
    return this.client.search(this.url, this.wiki, query, limit, mode, this.secret)
  }

  async docExists(filename: string): Promise<boolean> {
    try {
      await this.client.read(this.url, this.wiki, normalizeDocId(filename), undefined, this.secret)
      return true
    } catch (err: unknown) {
      // The API used to return 200 + `{ error }` for missing docs; it now
      // returns HTTP 404. Treat that single case as "exists = false";
      // re-throw anything else so real failures don't masquerade as 'no'.
      if (err instanceof RemoteError && err.status === 404) return false
      throw err
    }
  }

  async readRaw(filename: string): Promise<string> {
    return this.client.read(this.url, this.wiki, normalizeDocId(filename), { format: 'raw' }, this.secret)
  }

  async readDoc(filename: string): Promise<ParsedDoc> {
    const data = await this.client.read(this.url, this.wiki, normalizeDocId(filename), { format: 'json' }, this.secret)
    return {
      frontmatter: data.meta,
      body: data.content,
      links: data.links || [],
    }
  }

  async readSlice(filename: string, fromLine: number, toLine: number): Promise<ReadSliceResult> {
    return this.client.readSlice(this.url, this.wiki, normalizeDocId(filename), fromLine, toLine, this.secret)
  }

  async addDoc(input: DocInput, opts?: WriteOpts): Promise<WriteResult> {
    return this.client.addDoc(this.url, this.wiki, { ...input, dryRun: opts?.dryRun }, this.secret) as Promise<WriteResult>
  }

  async updateDoc(id: string, input: DocInput, opts?: WriteOpts): Promise<WriteResult> {
    return this.client.updateDoc(this.url, this.wiki, normalizeDocId(id), { ...input, dryRun: opts?.dryRun }, this.secret) as Promise<WriteResult>
  }

  async deleteDoc(id: string): Promise<{ deleted: string; warnings: string[] }> {
    return this.client.deleteDoc(this.url, this.wiki, normalizeDocId(id), this.secret)
  }

  async rename(oldId: string, newId: string): Promise<{ oldId: string; newId: string; linksUpdated: number }> {
    return this.client.rename(this.url, this.wiki, normalizeDocId(oldId), normalizeDocId(newId), this.secret)
  }

  async listDocs(filters?: { category?: string; tag?: string }): Promise<DocEntry[]> {
    return this.client.listDocs(this.url, this.wiki, filters, this.secret)
  }

  async categories(): Promise<string[]> {
    return this.client.categories(this.url, this.wiki, this.secret)
  }

  async related(id: string, limit: number): Promise<RelatedResult[]> {
    return this.client.related(this.url, this.wiki, normalizeDocId(id), limit, this.secret)
  }

  async lint(): Promise<LintIssue[]> {
    return this.client.lint(this.url, this.wiki, this.secret)
  }

  async lintFix(): Promise<{ fixed: number; repairs: LintRepair[] }> {
    return this.client.lintFix(this.url, this.wiki, this.secret) as Promise<{ fixed: number; repairs: LintRepair[] }>
  }

  async reindex(): Promise<ReindexResult> {
    return this.client.reindex(this.url, this.wiki, this.secret)
  }

  async reindexDoc(id: string): Promise<{ id: string; filename: string }> {
    return this.client.reindexDoc(this.url, this.wiki, normalizeDocId(id), this.secret)
  }

  async toc(): Promise<TocResult> {
    return this.client.toc(this.url, this.wiki, this.secret)
  }

  async log(limit: number): Promise<any[]> {
    return this.client.log(this.url, this.wiki, limit, this.secret)
  }

  async logAdd(op: string, doc?: string, details?: string): Promise<void> {
    await this.client.logAdd(this.url, this.wiki, op, doc, details, this.secret)
  }

  async schema(): Promise<string | object | null> {
    return this.client.schema(this.url, this.wiki, this.secret)
  }

  async schemaUpdate(): Promise<void> {
    await this.client.schemaUpdate(this.url, this.wiki, this.secret)
  }

  async info(): Promise<WikiInfo> {
    return this.client.wikiInfo(this.url, this.wiki, this.secret)
  }

  async resolve(input: string): Promise<ResolveResult> {
    return this.client.resolve(this.url, this.wiki, input, this.secret) as Promise<ResolveResult>
  }
}

/**
 * Single funnel that merges a partial `DocInput` over a base frontmatter.
 * Used by both addDoc (base = freshly-built skeleton) and updateDoc (base =
 * existing on-disk frontmatter). Undefined fields fall through to the base;
 * defined fields replace. Suppression fields go through this path too — any
 * future entry point that builds a `DocInput` automatically inherits the
 * suppression plumbing.
 */
function mergeFrontmatter(base: DocFrontmatter, input: DocInput): DocFrontmatter {
  return {
    ...base,
    ...(input.title !== undefined && { title: input.title }),
    ...(input.category !== undefined && { category: input.category }),
    ...(input.tags !== undefined && { tags: input.tags }),
    ...(input.importantSections !== undefined && { importantSections: input.importantSections }),
    ...(input.suppressMergeWarn !== undefined && { suppressMergeWarn: input.suppressMergeWarn }),
    ...(input.suppressLint !== undefined && { suppressLint: input.suppressLint }),
  }
}

/**
 * Build a canonical `DocInput` from any combination of:
 * - Raw markdown file content (with optional frontmatter — parsed via the
 *   ParserService and re-projected onto DocInput).
 * - Plain body text (e.g. from `--content` flag or stdin).
 * - Explicit field overrides (CLI flags `--title`, `--category`, `--tags`).
 *
 * Explicit overrides always win over file frontmatter (when both define the
 * same field). File frontmatter wins over plain text. Plain text contributes
 * only the body. This is the SINGLE composition function called by every
 * doc-writing entry point — CLI add, CLI update, HTTP POST, HTTP PUT — so
 * suppression and other frontmatter fields can never be silently dropped on
 * one path but honored on another.
 */
export function composeDocInput(args: {
  parser: ParserService
  rawFileContent?: string
  rawBody?: string
  appendBody?: string
  overrides?: DocInput
}): DocInput {
  let input: DocInput = {}
  if (args.rawFileContent !== undefined) {
    if (args.rawFileContent.startsWith('---')) {
      const parsed = args.parser.parse(args.rawFileContent)
      input = {
        title: parsed.frontmatter.title || undefined,
        category: parsed.frontmatter.category || undefined,
        tags: parsed.frontmatter.tags?.length ? parsed.frontmatter.tags : undefined,
        body: parsed.body,
        importantSections: parsed.frontmatter.importantSections,
        suppressMergeWarn: parsed.frontmatter.suppressMergeWarn,
        suppressLint: parsed.frontmatter.suppressLint,
      }
    } else {
      input.body = args.rawFileContent
    }
  } else if (args.rawBody !== undefined) {
    input.body = args.rawBody
  }
  if (args.appendBody !== undefined) input.appendBody = args.appendBody
  if (args.overrides) {
    // Drop undefined keys from overrides so they don't blank out file values.
    for (const k of Object.keys(args.overrides) as (keyof DocInput)[]) {
      if (args.overrides[k] !== undefined) (input as any)[k] = args.overrides[k]
    }
  }
  return input
}
