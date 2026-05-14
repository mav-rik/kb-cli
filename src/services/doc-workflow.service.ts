import { DocFrontmatter } from './parser.service.js'
import { ParserService } from './parser.service.js'
import { IndexService } from './index.service.js'
import { LinkerService } from './linker.service.js'
import { EmbeddingService } from './embedding.service.js'
import { ChunkerService } from './chunker.service.js'
import { ChunkFtsService } from './chunk-fts.service.js'
import { StorageService } from './storage.service.js'
import { toDocId, toFilename, canonicalize } from '../utils/slug.js'
import { contentHash } from '../utils/hash.js'

export interface LintIssue {
  type:
    | 'broken'
    | 'orphan'
    | 'missing'
    | 'drift'
    | 'long-paragraph'
    | 'doc-too-short'
    | 'doc-too-long'
    | 'chunk-merge'
    | 'corrupt-id'
  severity: 'error' | 'warning'
  file: string
  details: string
  /** Actionable remediation pointer. Surfaced inline by CLI formatters. */
  hint?: string
}

const LONG_PARAGRAPH_THRESHOLD = 1500
const DOC_TOO_SHORT_WORDS = 200
const DOC_TOO_LONG_WORDS = 1500

export interface ReindexResult {
  count: number
  elapsed: string
}

export interface LintRepair {
  type: 'broken' | 'drift' | 'corrupt-id'
  file: string
  action: string
}

export class DocWorkflowService {
  constructor(
    private parser: ParserService,
    private index: IndexService,
    private linker: LinkerService,
    private embedding: EmbeddingService,
    private storage: StorageService,
    private chunker: ChunkerService,
    private chunkFts: ChunkFtsService,
  ) {}

  /**
   * Index a document in all stores (index DB, FTS, chunk FTS, vector).
   *
   * `rawId` is normalized as defense-in-depth — wiki-ops already normalizes
   * at its public boundary, but a stray caller passing `foo.md` here would
   * otherwise plant a duplicate index row. The filename is derived from
   * the canonical id so the on-disk path always matches the index row.
   */
  async indexAndEmbed(kb: string, rawId: string, frontmatter: DocFrontmatter): Promise<void> {
    const { id, filename } = canonicalize(rawId)
    const rawFileContent = this.storage.readRaw(kb, filename)
    const parsed = this.parser.parse(rawFileContent)

    await this.index.upsertDoc(kb, {
      id,
      title: frontmatter.title,
      category: frontmatter.category,
      tags: frontmatter.tags,
      filePath: filename,
      contentHash: contentHash(parsed.body),
    })

    await this.index.upsertLinks(
      kb,
      id,
      parsed.links.map((l) => ({ toId: toDocId(l.target), linkText: l.text })),
    )

    const centroid = await this.indexChunks(kb, id, frontmatter, rawFileContent)
    const docVec = centroid ?? (await this.embedding.embed(frontmatter.title))
    await this.index.setEmbedding(kb, id, docVec)
  }

  private async indexChunks(
    kb: string,
    docId: string,
    frontmatter: DocFrontmatter,
    rawFileContent: string,
  ): Promise<Float32Array | null> {
    const chunks = this.chunker.chunk({
      docId,
      title: frontmatter.title,
      category: frontmatter.category,
      tags: frontmatter.tags,
      rawFileContent,
      importantSections: frontmatter.importantSections,
    })

    if (chunks.length === 0) {
      // chunkFts.deleteByDoc relies on chunks-table-as-bridge, so old chunk
      // rowids must still be present in chunks when it runs.
      this.chunkFts.deleteByDoc(kb, docId)
      await this.index.upsertChunks(kb, docId, [])
      return null
    }

    const existing = await this.index.listChunksForDoc(kb, docId)
    const existingMap = new Map(existing.map((c) => [c.id, c]))

    const embeddings: Float32Array[] = new Array(chunks.length)
    const toEmbedIdx: number[] = []
    for (let i = 0; i < chunks.length; i++) {
      const prev = existingMap.get(chunks[i].id)
      if (prev && prev.contentHash === chunks[i].contentHash && prev.embedding && prev.embedding.length > 0) {
        embeddings[i] = new Float32Array(prev.embedding)
      } else {
        toEmbedIdx.push(i)
      }
    }

    if (toEmbedIdx.length > 0) {
      const fresh = await this.embedding.embedBatch(toEmbedIdx.map((i) => chunks[i].embeddingInput))
      for (let k = 0; k < toEmbedIdx.length; k++) {
        embeddings[toEmbedIdx[k]] = fresh[k]
      }
    }

    const rawLines = rawFileContent.split(/\r?\n/)
    const sliceLines = (from: number, to: number) => rawLines.slice(from - 1, to).join('\n')

    // chunkFts.deleteByDoc relies on chunks-table-as-bridge, so old chunk
    // rowids must still be present in chunks when it runs — flush FTS first,
    // then rewrite the chunks rows.
    this.chunkFts.deleteByDoc(kb, docId)
    await this.index.upsertChunks(
      kb,
      docId,
      chunks.map((c, i) => ({
        id: c.id,
        heading: c.heading,
        headingPath: c.headingPath,
        headingLevel: c.headingLevel,
        fromLine: c.fromLine,
        toLine: c.toLine,
        position: c.position,
        contentHash: c.contentHash,
        embedding: embeddings[i],
      })),
    )

    for (const c of chunks) {
      this.chunkFts.upsert(kb, {
        id: c.id,
        docId,
        headingPath: c.headingPath,
        heading: c.heading,
        title: frontmatter.title,
        tags: frontmatter.tags ?? [],
        content: sliceLines(c.fromLine, c.toLine),
      })
    }

    // Centroid feeds the doc-level vector index so `kb related` keeps working
    // without a separate doc-embedding pass.
    const dim = embeddings[0].length
    const out = new Float32Array(dim)
    for (const v of embeddings) for (let i = 0; i < dim; i++) out[i] += v[i]
    let norm = 0
    for (let i = 0; i < dim; i++) {
      out[i] /= embeddings.length
      norm += out[i] * out[i]
    }
    norm = Math.sqrt(norm) || 1
    for (let i = 0; i < dim; i++) out[i] /= norm
    return out
  }

  /**
   * Remove a document from all index stores.
   * The `__ad` AFTER DELETE trigger on `documents` clears the vec0 shadow
   * automatically when IndexService.deleteDoc runs.
   */
  async removeFromIndex(kb: string, docId: string): Promise<void> {
    // chunkFts.deleteByDoc relies on chunks-table-as-bridge, so it must run
    // before index.deleteDoc cascades through the chunks rows.
    this.chunkFts.deleteByDoc(kb, docId)
    await this.index.deleteDoc(kb, docId)
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

    // corrupt-id: index rows whose primary key ends in ".md" — symptom of
    // pre-normalization writes (e.g. `kb update foo.md` on older versions
    // planted a phantom row). `--fix` deletes the orphan row + cascades;
    // the canonical row gets re-indexed via drift if needed.
    const allDocs = await this.index.listDocs(kb)
    for (const d of allDocs) {
      if (d.id.toLowerCase().endsWith('.md')) {
        issues.push({
          type: 'corrupt-id',
          severity: 'error',
          file: toFilename(d.id),
          details: `Index row id="${d.id}" has .md suffix; canonical id is "${d.id.slice(0, -3)}"`,
        })
      }
    }

    const files = this.storage.listFiles(kb)
    for (const file of files) {
      const raw = this.storage.readRaw(kb, file)
      issues.push(...this.lintRawDoc(raw, file))

      // drift is the only check that compares against the persisted index,
      // so it stays out of the dry-runnable lintRawDoc path.
      const parsed = this.parser.parse(raw)
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
   * Per-doc lint subset that needs only the raw markdown — no disk/index
   * access. Used by `lint()` for each file AND by `kb add/update --dry-run`
   * to surface retrievability issues before the doc enters the index.
   *
   * Excludes KB-global checks (broken, orphan) and persistence-coupled
   * checks (drift) — those live in lint() proper.
   */
  lintRawDoc(rawContent: string, filename: string): LintIssue[] {
    const issues: LintIssue[] = []
    const parsed = this.parser.parse(rawContent)
    const docId = toDocId(filename)

    const missing: string[] = []
    if (!parsed.frontmatter.id) missing.push('id')
    if (!parsed.frontmatter.title) missing.push('title')
    if (!parsed.frontmatter.category) missing.push('category')
    if (missing.length > 0) {
      // If the user set any suppression field but forgot the required ones,
      // call that out — the common shape of this mistake is "staged a snippet
      // with suppress_lint at the top, didn't realize id/title/category are
      // still required for the doc to be indexable at all."
      const usingSuppression =
        (parsed.frontmatter.suppressLint?.length ?? 0) > 0 ||
        (parsed.frontmatter.importantSections?.length ?? 0) > 0 ||
        (parsed.frontmatter.suppressMergeWarn?.length ?? 0) > 0
      const hint = usingSuppression
        ? `Required frontmatter (id, title, category) must be present even when using suppress_lint / suppress_merge_warn / important_sections.`
        : `Add frontmatter at the top of the file: --- id, title, category --- (tags optional).`
      issues.push({
        type: 'missing',
        severity: 'error',
        file: filename,
        details: `Missing frontmatter: ${missing.join(', ')}`,
        hint,
      })
    }

    const suppressLint = new Set((parsed.frontmatter.suppressLint ?? []).map((s) => s.toLowerCase()))

    if (!suppressLint.has('long-paragraph')) {
      const longParagraphs = this.findLongParagraphs(parsed.body, LONG_PARAGRAPH_THRESHOLD)
      for (const p of longParagraphs) {
        issues.push({
          type: 'long-paragraph',
          severity: 'warning',
          file: filename,
          details: `line ${p.fromLine}: ${p.chars} chars`,
          hint: `Break into smaller paragraphs (the 512-token embedding model will truncate). If the wall of text is deliberate (transcript, quote), add long-paragraph to frontmatter suppress_lint.`,
        })
      }
    }

    const wordCount = parsed.body.split(/\s+/).filter(Boolean).length
    if (wordCount < DOC_TOO_SHORT_WORDS && !suppressLint.has('doc-too-short')) {
      issues.push({
        type: 'doc-too-short',
        severity: 'warning',
        file: filename,
        details: `${wordCount} words`,
        hint: `Expand to >200 words, or fold into a larger doc. For intentional index/landing pages, add doc-too-short to frontmatter suppress_lint.`,
      })
    }
    if (wordCount > DOC_TOO_LONG_WORDS && !suppressLint.has('doc-too-long')) {
      issues.push({
        type: 'doc-too-long',
        severity: 'warning',
        file: filename,
        details: `${wordCount} words`,
        hint: `Split into linked sub-docs (one topic each). For canonical references that shouldn't split, add doc-too-long to frontmatter suppress_lint.`,
      })
    }

    if (suppressLint.has('chunk-merge')) return issues

    const { mergedAway } = this.chunker.chunkWithMergeReport({
      docId,
      title: parsed.frontmatter.title,
      category: parsed.frontmatter.category,
      tags: parsed.frontmatter.tags,
      rawFileContent: rawContent,
      importantSections: parsed.frontmatter.importantSections,
    })
    const suppressed = new Set(
      (parsed.frontmatter.suppressMergeWarn ?? []).map((s) => s.toLowerCase()),
    )
    for (const c of mergedAway) {
      const heading = c.heading
      if (heading && suppressed.has(heading.toLowerCase())) continue
      issues.push({
        type: 'chunk-merge',
        severity: 'warning',
        file: filename,
        details: `"${heading ?? '(intro)'}" lines ${c.fromLine}-${c.toLine}`,
        hint: `Add intentional section names to frontmatter important_sections (preserve) or suppress_merge_warn (silence). Otherwise restructure / expand the section past ~160 chars and <50% link syntax.`,
      })
    }

    return issues
  }

  // v1 splits paragraphs on blank lines without tracking code-fence state, so
  // a long fenced code block separated by blank lines internally would already
  // count as multiple paragraphs (a benign false negative); a single fenced
  // block over 1500 chars with no internal blanks correctly flags as one long
  // paragraph. The agent who hits a false positive can break the surrounding
  // prose into smaller paragraphs.
  private findLongParagraphs(body: string, threshold: number): Array<{ fromLine: number; chars: number }> {
    const lines = body.split('\n')
    const result: Array<{ fromLine: number; chars: number }> = []
    let curStart = -1
    for (let i = 0; i < lines.length; i++) {
      const isBlank = lines[i].trim() === ''
      if (!isBlank && curStart < 0) {
        curStart = i
      } else if (isBlank && curStart >= 0) {
        const text = lines.slice(curStart, i).join('\n')
        if (text.length > threshold) {
          result.push({ fromLine: curStart + 1, chars: text.length })
        }
        curStart = -1
      }
    }
    if (curStart >= 0) {
      const text = lines.slice(curStart).join('\n')
      if (text.length > threshold) {
        result.push({ fromLine: curStart + 1, chars: text.length })
      }
    }
    return result
  }

  /**
   * Fix auto-fixable lint issues (broken links and index drift).
   * Returns the number of fixes applied.
   */
  async lintFix(kb: string, issues: LintIssue[]): Promise<LintRepair[]> {
    const repairs: LintRepair[] = []

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
            repairs.push({ type: 'broken', file: issue.file, action: `removed broken link to ${target}` })
          }
        }
      } else if (issue.type === 'drift') {
        // Full re-index: stale chunks/FTS/embeddings need rebuilding, not just
        // a contentHash bump. Otherwise search returns the old content while
        // the lint warning silently disappears.
        const doc = this.storage.readDoc(kb, issue.file)
        const docId = toDocId(issue.file)
        await this.indexAndEmbed(kb, docId, doc.frontmatter)
        repairs.push({ type: 'drift', file: issue.file, action: 'reindexed (content changed since last index)' })
      } else if (issue.type === 'corrupt-id') {
        // Heal: parse the bad id out of the details and remove its index row.
        // The canonical row (id without .md) is left alone — drift handler
        // will re-index it if it's stale.
        const m = issue.details.match(/id="([^"]+)"/)
        if (m) {
          await this.removeFromIndex(kb, m[1])
          repairs.push({ type: 'corrupt-id', file: issue.file, action: `removed orphan index row "${m[1]}"` })
        }
      }
    }

    return repairs
  }

  /**
   * Full reindex: drop all index data and rebuild from files.
   * Each doc is chunked, chunks are embedded, and the doc embedding is
   * the centroid of its chunk embeddings.
   */
  async reindex(kb: string, onProgress?: (current: number, total: number) => void): Promise<ReindexResult> {
    const startTime = Date.now()

    await this.index.dropAll(kb)
    this.chunkFts.dropAll(kb)

    const files = this.storage.listFiles(kb)

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const doc = this.storage.readDoc(kb, file)
      await this.indexAndEmbed(kb, toDocId(file), doc.frontmatter)
      if (onProgress) onProgress(i + 1, files.length)
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
    await this.indexAndEmbed(kb, newId, frontmatter)

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
