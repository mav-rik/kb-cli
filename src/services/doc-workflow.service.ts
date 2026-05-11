import { DocFrontmatter } from './parser.service.js'
import { ParserService } from './parser.service.js'
import { IndexService } from './index.service.js'
import { LinkerService } from './linker.service.js'
import { EmbeddingService } from './embedding.service.js'
import { VectorService } from './vector.service.js'
import { FtsService } from './fts.service.js'
import { StorageService } from './storage.service.js'
import { toDocId } from '../utils/slug.js'
import { contentHash } from '../utils/hash.js'

export interface LintIssue {
  type: 'broken' | 'orphan' | 'missing' | 'drift'
  severity: 'error' | 'warning'
  file: string
  details: string
}

export interface ReindexResult {
  count: number
  elapsed: string
}

export class DocWorkflowService {
  constructor(
    private parser: ParserService,
    private index: IndexService,
    private linker: LinkerService,
    private embedding: EmbeddingService,
    private vector: VectorService,
    private fts: FtsService,
    private storage: StorageService,
  ) {}

  /**
   * Index a document in all stores (index DB, FTS, vector).
   */
  async indexAndEmbed(kb: string, docId: string, frontmatter: DocFrontmatter, body: string, filename: string): Promise<void> {
    const links = this.parser.extractLinks(body)

    await this.index.upsertDoc(kb, {
      id: docId,
      title: frontmatter.title,
      category: frontmatter.category,
      tags: frontmatter.tags,
      filePath: filename,
      contentHash: contentHash(body),
    })

    await this.index.upsertLinks(
      kb,
      docId,
      links.map((l) => ({ toId: toDocId(l.target), linkText: l.text })),
    )

    this.fts.upsert(kb, docId, frontmatter.title, frontmatter.tags || [], body)

    this.vector.ensureTables(kb)
    const vec = await this.embedding.embed(body)
    this.vector.upsertVec(kb, docId, vec)
  }

  /**
   * Remove a document from all index stores.
   */
  async removeFromIndex(kb: string, docId: string): Promise<void> {
    await this.index.deleteDoc(kb, docId)
    this.vector.ensureTables(kb)
    this.vector.deleteVec(kb, docId)
    this.fts.delete(kb, docId)
  }

  /**
   * Lint: find all integrity issues in a KB.
   */
  async lint(kb: string): Promise<LintIssue[]> {
    const issues: LintIssue[] = []

    const brokenLinks = this.linker.findBrokenLinks(kb)
    for (const bl of brokenLinks) {
      issues.push({
        type: 'broken',
        severity: 'error',
        file: bl.fromFile,
        details: `Link to ./${bl.targetFile} not found`,
      })
    }

    const orphans = await this.linker.findOrphans(kb)
    for (const orphan of orphans) {
      issues.push({
        type: 'orphan',
        severity: 'warning',
        file: orphan,
        details: 'No incoming links',
      })
    }

    const files = this.storage.listFiles(kb)
    for (const file of files) {
      const raw = this.storage.readRaw(kb, file)
      const parsed = this.parser.parse(raw)

      const missing: string[] = []
      if (!parsed.frontmatter.id) missing.push('id')
      if (!parsed.frontmatter.title) missing.push('title')
      if (!parsed.frontmatter.category) missing.push('category')
      if (missing.length > 0) {
        issues.push({
          type: 'missing',
          severity: 'error',
          file,
          details: `Missing frontmatter: ${missing.join(', ')}`,
        })
      }

      const fileHash = contentHash(parsed.body)
      const docId = toDocId(file)
      const indexDoc = await this.index.getDoc(kb, docId)
      if (indexDoc && indexDoc.contentHash !== fileHash) {
        issues.push({
          type: 'drift',
          severity: 'warning',
          file,
          details: 'Index out of sync with file content',
        })
      }
    }

    return issues
  }

  /**
   * Fix auto-fixable lint issues (broken links and index drift).
   * Returns the number of fixes applied.
   */
  async lintFix(kb: string, issues: LintIssue[]): Promise<number> {
    let fixedCount = 0

    for (const issue of issues) {
      if (issue.type === 'broken') {
        const raw = this.storage.readRaw(kb, issue.file)
        const targetMatch = issue.details.match(/Link to \.\/([\w.@-]+\.md) not found/)
        if (targetMatch) {
          const target = targetMatch[1]
          const linkPattern = new RegExp(
            `\\[([^\\]]+)\\]\\(\\.\\/` + target.replace(/\./g, '\\.') + `\\)`,
            'g',
          )
          const fixed = raw.replace(linkPattern, '$1')
          if (fixed !== raw) {
            const parsed = this.parser.parse(fixed)
            this.storage.writeDoc(kb, issue.file, parsed.frontmatter, parsed.body)
            fixedCount++
          }
        }
      } else if (issue.type === 'drift') {
        const doc = this.storage.readDoc(kb, issue.file)
        const docId = toDocId(issue.file)
        await this.index.upsertDoc(kb, {
          id: docId,
          title: doc.frontmatter.title,
          category: doc.frontmatter.category,
          tags: doc.frontmatter.tags,
          filePath: issue.file,
          contentHash: contentHash(doc.body),
        })
        fixedCount++
      }
    }

    return fixedCount
  }

  /**
   * Full reindex: drop all index data and rebuild from files.
   * The optional onProgress callback is called with (current, total) for each file.
   */
  async reindex(kb: string, onProgress?: (current: number, total: number) => void): Promise<ReindexResult> {
    const startTime = Date.now()

    await this.index.dropAll(kb)
    this.vector.ensureTables(kb)
    this.vector.dropAll(kb)
    this.fts.dropAll(kb)

    const files = this.storage.listFiles(kb)

    for (let i = 0; i < files.length; i++) {
      if (onProgress) onProgress(i + 1, files.length)

      const file = files[i]
      const doc = this.storage.readDoc(kb, file)
      const docId = toDocId(file)
      const hash = contentHash(doc.body)

      await this.index.upsertDoc(kb, {
        id: docId,
        title: doc.frontmatter.title,
        category: doc.frontmatter.category,
        tags: doc.frontmatter.tags,
        filePath: file,
        contentHash: hash,
      })

      if (doc.links.length > 0) {
        await this.index.upsertLinks(
          kb,
          docId,
          doc.links.map((l) => ({ toId: toDocId(l.target), linkText: l.text })),
        )
      }

      this.fts.upsert(kb, docId, doc.frontmatter.title, doc.frontmatter.tags || [], doc.body || '')

      const embedding = await this.embedding.embed(doc.body || doc.frontmatter.title)
      this.vector.upsertVec(kb, docId, embedding)
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    return { count: files.length, elapsed: `${elapsed}s` }
  }

  /**
   * Find documents related to a given doc via vector similarity.
   */
  async findRelated(kb: string, docId: string, filename: string, limit: number): Promise<[string, number][]> {
    const parsed = this.storage.readDoc(kb, filename)
    const queryText = `${parsed.frontmatter.title} ${parsed.body}`.slice(0, 500)
    const queryVec = await this.embedding.embed(queryText)

    const vecResults = this.vector.searchVec(kb, queryVec, limit + 1)
    const filtered = vecResults.filter((r) => r.id !== docId).slice(0, limit)

    return filtered.map(({ id: relId, distance }) => [relId, 1 / (1 + distance)])
  }
}
