import type { SearchMode, SearchResult } from './search.service.js'
import type { LintIssue, ReindexResult } from './doc-workflow.service.js'
import type { ParsedDoc, DocFrontmatter } from './parser.service.js'
import type { RemoteClient } from './remote-client.js'
import type { StorageService } from './storage.service.js'
import type { SearchService } from './search.service.js'
import type { IndexService } from './index.service.js'
import type { DocWorkflowService } from './doc-workflow.service.js'
import type { SchemaService } from './schema.service.js'
import type { ActivityLogService } from './activity-log.service.js'
import { slugify, toFilename, toDocId, today } from '../utils/slug.js'

export interface UpdatePatch {
  title?: string
  category?: string
  tags?: string[]
  content?: string
  append?: string
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

export interface WikiOps {
  search(query: string, limit: number, mode: SearchMode): Promise<SearchResult[]>
  docExists(filename: string): Promise<boolean>
  readRaw(filename: string): Promise<string>
  readDoc(filename: string): Promise<ParsedDoc>
  addDoc(title: string, category: string, tags: string[], content: string): Promise<{ id: string; filename: string }>
  updateDoc(id: string, patch: UpdatePatch): Promise<{ id: string; filename: string }>
  deleteDoc(id: string): Promise<{ deleted: string; warnings: string[] }>
  rename(oldId: string, newId: string): Promise<{ oldId: string; newId: string; linksUpdated: number }>
  listDocs(filters?: { category?: string; tag?: string }): Promise<DocEntry[]>
  categories(): Promise<string[]>
  related(id: string, limit: number): Promise<SearchResult[]>
  lint(): Promise<LintIssue[]>
  lintFix(): Promise<{ fixed: number }>
  reindex(): Promise<ReindexResult>
  toc(): Promise<TocResult>
  log(limit: number): Promise<any[]>
  logAdd(op: string, doc?: string, details?: string): Promise<void>
  schema(): Promise<string | object | null>
  schemaUpdate(): Promise<void>
}

export interface LocalServices {
  storage: StorageService
  search: SearchService
  index: IndexService
  workflow: DocWorkflowService
  schema: SchemaService
  activityLog: ActivityLogService
}

export class LocalWikiOps implements WikiOps {
  constructor(private kb: string, private svc: LocalServices) {}

  async search(query: string, limit: number, mode: SearchMode): Promise<SearchResult[]> {
    return this.svc.search.search(this.kb, query, limit, mode)
  }

  async docExists(filename: string): Promise<boolean> {
    return this.svc.storage.docExists(this.kb, filename)
  }

  async readRaw(filename: string): Promise<string> {
    return this.svc.storage.readRaw(this.kb, filename)
  }

  async readDoc(filename: string): Promise<ParsedDoc> {
    return this.svc.storage.readDoc(this.kb, filename)
  }

  async addDoc(title: string, category: string, tags: string[], content: string): Promise<{ id: string; filename: string }> {
    const id = slugify(title)
    const filename = `${id}.md`

    if (this.svc.storage.docExists(this.kb, filename)) {
      throw new Error(`Document "${filename}" already exists in wiki "${this.kb}".`)
    }

    const frontmatter: DocFrontmatter = {
      id,
      title,
      category,
      tags,
      created: today(),
      updated: today(),
    }

    this.svc.storage.writeDoc(this.kb, filename, frontmatter, content)
    await this.svc.workflow.indexAndEmbed(this.kb, id, frontmatter, content, filename)
    this.svc.activityLog.log(this.kb, 'add', id, `category=${category}`)

    return { id, filename }
  }

  async updateDoc(id: string, patch: UpdatePatch): Promise<{ id: string; filename: string }> {
    const filename = toFilename(id)

    if (!this.svc.storage.docExists(this.kb, filename)) {
      throw new Error(`Document "${filename}" not found in wiki "${this.kb}".`)
    }

    const doc = this.svc.storage.readDoc(this.kb, filename)

    const frontmatter: DocFrontmatter = {
      ...doc.frontmatter,
      ...(patch.title !== undefined && { title: patch.title }),
      ...(patch.category !== undefined && { category: patch.category }),
      ...(patch.tags !== undefined && { tags: patch.tags }),
      updated: today(),
    }

    let body = doc.body
    if (patch.content !== undefined) {
      body = patch.content
    } else if (patch.append !== undefined) {
      body = body + patch.append
    }

    this.svc.storage.writeDoc(this.kb, filename, frontmatter, body)
    await this.svc.workflow.indexAndEmbed(this.kb, id, frontmatter, body, filename)
    this.svc.activityLog.log(this.kb, 'update', id)

    return { id, filename }
  }

  async deleteDoc(id: string): Promise<{ deleted: string; warnings: string[] }> {
    const filename = toFilename(id)

    if (!this.svc.storage.docExists(this.kb, filename)) {
      throw new Error(`Document "${filename}" not found in wiki "${this.kb}".`)
    }

    const backlinks = await this.svc.index.getLinksTo(this.kb, id)
    const warnings: string[] = []
    if (backlinks.length > 0) {
      const sources = backlinks.map((l) => `${l.fromId}.md`)
      warnings.push(
        `${backlinks.length} document(s) have broken links to ${filename}: ${sources.join(', ')}`,
      )
    }

    this.svc.storage.deleteDoc(this.kb, filename)
    await this.svc.workflow.removeFromIndex(this.kb, id)
    this.svc.activityLog.log(this.kb, 'delete', id)

    return { deleted: filename, warnings }
  }

  async rename(oldId: string, newId: string): Promise<{ oldId: string; newId: string; linksUpdated: number }> {
    const oldFilename = `${oldId}.md`
    const newFilename = `${newId}.md`

    if (!this.svc.storage.docExists(this.kb, oldFilename)) {
      throw new Error(`Document "${oldFilename}" not found in wiki "${this.kb}".`)
    }

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

  async related(id: string, limit: number): Promise<SearchResult[]> {
    const filename = toFilename(id)
    const scored = await this.svc.workflow.findRelated(this.kb, id, filename, limit)
    return this.svc.search.buildResults(this.kb, scored)
  }

  async lint(): Promise<LintIssue[]> {
    return this.svc.workflow.lint(this.kb)
  }

  async lintFix(): Promise<{ fixed: number }> {
    const issues = await this.svc.workflow.lint(this.kb)
    const fixed = await this.svc.workflow.lintFix(this.kb, issues)
    return { fixed }
  }

  async reindex(): Promise<ReindexResult> {
    return this.svc.workflow.reindex(this.kb)
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
    const data = await this.client.read(this.url, this.wiki, filename, undefined, this.secret)
    return !data.error
  }

  async readRaw(filename: string): Promise<string> {
    return this.client.read(this.url, this.wiki, filename, { format: 'raw' }, this.secret)
  }

  async readDoc(filename: string): Promise<ParsedDoc> {
    const data = await this.client.read(this.url, this.wiki, filename, { format: 'json' }, this.secret)
    if (data.error) throw new Error(data.error)
    return {
      frontmatter: data.meta,
      body: data.content,
      links: data.links || [],
    }
  }

  async addDoc(title: string, category: string, tags: string[], content: string): Promise<{ id: string; filename: string }> {
    return this.client.addDoc(this.url, this.wiki, { title, category, tags, content }, this.secret)
  }

  async updateDoc(id: string, patch: UpdatePatch): Promise<{ id: string; filename: string }> {
    return this.client.updateDoc(this.url, this.wiki, id, patch, this.secret)
  }

  async deleteDoc(id: string): Promise<{ deleted: string; warnings: string[] }> {
    return this.client.deleteDoc(this.url, this.wiki, id, this.secret)
  }

  async rename(oldId: string, newId: string): Promise<{ oldId: string; newId: string; linksUpdated: number }> {
    return this.client.rename(this.url, this.wiki, oldId, newId, this.secret)
  }

  async listDocs(filters?: { category?: string; tag?: string }): Promise<DocEntry[]> {
    return this.client.listDocs(this.url, this.wiki, filters, this.secret)
  }

  async categories(): Promise<string[]> {
    return this.client.categories(this.url, this.wiki, this.secret)
  }

  async related(id: string, limit: number): Promise<SearchResult[]> {
    return this.client.related(this.url, this.wiki, id, limit, this.secret)
  }

  async lint(): Promise<LintIssue[]> {
    return this.client.lint(this.url, this.wiki, this.secret)
  }

  async lintFix(): Promise<{ fixed: number }> {
    return this.client.lintFix(this.url, this.wiki, this.secret)
  }

  async reindex(): Promise<ReindexResult> {
    return this.client.reindex(this.url, this.wiki, this.secret)
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
}
