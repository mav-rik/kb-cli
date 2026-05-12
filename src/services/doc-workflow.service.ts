import { DocFrontmatter } from './parser.service.js'
import { ParserService } from './parser.service.js'
import { IndexService } from './index.service.js'
import { LinkerService } from './linker.service.js'
import { EmbeddingService } from './embedding.service.js'
import { FtsService } from './fts.service.js'
import { StorageService } from './storage.service.js'
import { toDocId } from '../utils/slug.js'
import { contentHash } from '../utils/hash.js'
import { chunk } from '../utils/chunk.js'

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
    private fts: FtsService,
    private storage: StorageService,
  ) {}

  /**
   * Index a document in all stores (index DB, FTS, vector).
   */
  async indexAndEmbed(kb: string, docId: string, frontmatter: DocFrontmatter, body: string, filename: string): Promise<void> {
    // Read back from disk to get the canonical form (after serialization round-trip)
    const onDisk = this.storage.readDoc(kb, filename)
    const canonicalBody = onDisk.body
    const links = this.parser.extractLinks(canonicalBody)

    await this.index.upsertDoc(kb, {
      id: docId,
      title: frontmatter.title,
      category: frontmatter.category,
      tags: frontmatter.tags,
      filePath: filename,
      contentHash: contentHash(canonicalBody),
    })

    await this.index.upsertLinks(
      kb,
      docId,
      links.map((l) => ({ toId: toDocId(l.target), linkText: l.text })),
    )

    this.fts.upsert(kb, docId, frontmatter.title, frontmatter.tags || [], canonicalBody)

    const vec = await this.embedding.embed(canonicalBody || frontmatter.title)
    await this.index.setEmbedding(kb, docId, vec)
  }

  /**
   * Remove a document from all index stores.
   * The `__ad` AFTER DELETE trigger on `documents` clears the vec0 shadow
   * automatically when IndexService.deleteDoc runs.
   */
  async removeFromIndex(kb: string, docId: string): Promise<void> {
    await this.index.deleteDoc(kb, docId)
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
   * Embeddings are computed in batches of 25 via `embedBatch` — much
   * cheaper than per-doc `embed()` on multi-doc wikis. The optional
   * `onProgress` callback fires once per doc (after batch embedding,
   * during the per-doc DB write loop) so progress UI stays smooth.
   */
  async reindex(kb: string, onProgress?: (current: number, total: number) => void): Promise<ReindexResult> {
    const startTime = Date.now()
    const BATCH = 25

    // index.dropAll empties the documents table; the AFTER DELETE trigger
    // on the vec0 shadow keeps the vector index in lockstep automatically.
    await this.index.dropAll(kb)
    this.fts.dropAll(kb)

    const files = this.storage.listFiles(kb)

    // Read & parse all docs up front. This is cheap (sync fs) compared to
    // the per-doc DB + embedding work that follows.
    const parsed = files.map((file) => {
      const doc = this.storage.readDoc(kb, file)
      return { file, docId: toDocId(file), doc, hash: contentHash(doc.body) }
    })

    let processed = 0
    for (const batch of chunk(parsed, BATCH)) {
      const texts = batch.map((p) => p.doc.body || p.doc.frontmatter.title)
      const vectors = await this.embedding.embedBatch(texts)

      for (let j = 0; j < batch.length; j++) {
        const p = batch[j]
        const vec = vectors[j]
        await this.index.upsertDoc(kb, {
          id: p.docId,
          title: p.doc.frontmatter.title,
          category: p.doc.frontmatter.category,
          tags: p.doc.frontmatter.tags,
          filePath: p.file,
          contentHash: p.hash,
        })

        if (p.doc.links.length > 0) {
          await this.index.upsertLinks(
            kb,
            p.docId,
            p.doc.links.map((l) => ({ toId: toDocId(l.target), linkText: l.text })),
          )
        }

        this.fts.upsert(kb, p.docId, p.doc.frontmatter.title, p.doc.frontmatter.tags || [], p.doc.body || '')
        await this.index.setEmbedding(kb, p.docId, vec)

        processed++
        if (onProgress) onProgress(processed, parsed.length)
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    return { count: files.length, elapsed: `${elapsed}s` }
  }

  /**
   * Perform a full rename: move the doc, update cross-links, re-index everything.
   * Returns the number of documents whose links were updated.
   */
  async rename(kb: string, oldId: string, newId: string, oldFilename: string, newFilename: string): Promise<number> {
    const doc = this.storage.readDoc(kb, oldFilename)
    const frontmatter = { ...doc.frontmatter, id: newId, updated: new Date().toISOString().split('T')[0] }

    this.storage.writeDoc(kb, newFilename, frontmatter, doc.body)
    this.storage.deleteDoc(kb, oldFilename)

    const linksUpdated = await this.linker.updateLinksAcrossKb(kb, oldFilename, newFilename)

    await this.removeFromIndex(kb, oldId)
    await this.indexAndEmbed(kb, newId, frontmatter, doc.body, newFilename)

    // Re-index links for docs that now reference the new filename
    const files = this.storage.listFiles(kb)
    for (const file of files) {
      if (file === newFilename) continue
      const fileDoc = this.storage.readDoc(kb, file)
      const fileLinks = this.parser.extractLinks(fileDoc.body)
      if (fileLinks.some((l) => l.target === newFilename)) {
        const fileId = toDocId(file)
        await this.index.upsertLinks(
          kb,
          fileId,
          fileLinks.map((l) => ({ toId: toDocId(l.target), linkText: l.text })),
        )
      }
    }

    return linksUpdated
  }

  /**
   * Find documents related to a given doc via vector similarity.
   */
  async findRelated(kb: string, docId: string, filename: string, limit: number): Promise<[string, number][]> {
    const parsed = this.storage.readDoc(kb, filename)
    const queryText = `${parsed.frontmatter.title} ${parsed.body}`.slice(0, 500)
    const queryVec = await this.embedding.embed(queryText)

    const vecResults = await this.index.semanticSearch(kb, queryVec, limit + 1)
    const filtered = vecResults.filter((r) => r.id !== docId).slice(0, limit)

    return filtered.map(({ id: relId, distance }) => [relId, 1 / (1 + distance)])
  }
}
