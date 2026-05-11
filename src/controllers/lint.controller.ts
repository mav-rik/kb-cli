import { Controller, Cli, CliOption, Description, Optional } from '@moostjs/event-cli'
import { services } from '../services/container.js'
import { toDocId } from '../utils/slug.js'
import { contentHash } from '../utils/hash.js'

interface LintIssue {
  type: 'broken' | 'orphan' | 'missing' | 'drift'
  severity: 'error' | 'warning'
  file: string
  details: string
}

@Controller()
export class LintController {
  private get config() { return services.config }
  private get storage() { return services.storage }
  private get parser() { return services.parser }
  private get index() { return services.index }
  private get linker() { return services.linker }
  private get embedding() { return services.embedding }
  private get vector() { return services.vector }
  private get fts() { return services.fts }

  @Cli('lint')
  @Description('Check knowledge base integrity')
  async lint(
    @Description('Auto-fix issues') @CliOption('fix') fix: boolean,
    @Description('Knowledge base') @CliOption('kb') @Optional() kb: string,
  ): Promise<string> {
    const kbName = this.config.resolveKb(kb)
    const issues: LintIssue[] = []

    const brokenLinks = this.linker.findBrokenLinks(kbName)
    for (const bl of brokenLinks) {
      issues.push({
        type: 'broken',
        severity: 'error',
        file: bl.fromFile,
        details: `Link to ./${bl.targetFile} not found`,
      })
    }

    const orphans = await this.linker.findOrphans(kbName)
    for (const orphan of orphans) {
      issues.push({
        type: 'orphan',
        severity: 'warning',
        file: orphan,
        details: 'No incoming links',
      })
    }

    const files = this.storage.listFiles(kbName)
    for (const file of files) {
      const raw = this.storage.readRaw(kbName, file)
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
      const indexDoc = await this.index.getDoc(kbName, docId)
      if (indexDoc && indexDoc.contentHash !== fileHash) {
        issues.push({
          type: 'drift',
          severity: 'warning',
          file,
          details: 'Index out of sync with file content',
        })
      }
    }

    let fixedCount = 0
    if (fix) {
      for (const issue of issues) {
        if (issue.type === 'broken') {
          const raw = this.storage.readRaw(kbName, issue.file)
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
              this.storage.writeDoc(kbName, issue.file, parsed.frontmatter, parsed.body)
              fixedCount++
            }
          }
        } else if (issue.type === 'drift') {
          const doc = this.storage.readDoc(kbName, issue.file)
          const docId = toDocId(issue.file)
          await this.index.upsertDoc(kbName, {
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
    }

    if (issues.length === 0) {
      return `Lint report for "${kbName}" (0 issues found): All clear!`
    }

    const lines: string[] = []
    lines.push(`Lint report for "${kbName}" (${issues.length} issues found):`)
    lines.push('')
    lines.push('Type     | Severity | File            | Details')
    lines.push('---------|----------|-----------------|----------------------------------')
    for (const issue of issues) {
      const type = issue.type.padEnd(8)
      const severity = issue.severity.padEnd(8)
      const file = issue.file.padEnd(15)
      lines.push(`${type} | ${severity} | ${file} | ${issue.details}`)
    }

    if (fix && fixedCount > 0) {
      lines.push('')
      lines.push(`Fixed ${fixedCount} issues.`)
    }

    return lines.join('\n')
  }

  @Cli('reindex')
  @Description('Rebuild index from markdown files')
  async reindex(
    @Description('Knowledge base') @CliOption('kb') @Optional() kb: string,
  ): Promise<string> {
    const kbName = this.config.resolveKb(kb)
    const startTime = Date.now()

    await this.index.dropAll(kbName)

    this.vector.ensureTables(kbName)
    this.vector.dropAll(kbName)
    this.fts.dropAll(kbName)

    const files = this.storage.listFiles(kbName)
    const total = files.length

    if (total === 0) {
      return `Reindexed 0 documents in 0.0s.`
    }

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      process.stderr.write(`Reindexing... ${i + 1}/${total}\r`)

      const doc = this.storage.readDoc(kbName, file)
      const docId = toDocId(file)
      const hash = contentHash(doc.body)

      await this.index.upsertDoc(kbName, {
        id: docId,
        title: doc.frontmatter.title,
        category: doc.frontmatter.category,
        tags: doc.frontmatter.tags,
        filePath: file,
        contentHash: hash,
      })

      if (doc.links.length > 0) {
        await this.index.upsertLinks(
          kbName,
          docId,
          doc.links.map((l) => ({ toId: toDocId(l.target), linkText: l.text })),
        )
      }

      this.fts.upsert(kbName, docId, doc.frontmatter.title, doc.frontmatter.tags || [], doc.body || '')

      const embedding = await this.embedding.embed(doc.body || doc.frontmatter.title)
      this.vector.upsertVec(kbName, docId, embedding)
    }

    process.stderr.write('\n')

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    return `Reindexed ${total} documents in ${elapsed}s.`
  }

  @Cli('toc')
  @Description('Display table of contents for a knowledge base')
  async toc(
    @Description('Knowledge base') @CliOption('kb') @Optional() kb: string,
  ): Promise<string> {
    const kbName = this.config.resolveKb(kb)

    const docs = await this.index.listDocs(kbName)

    if (docs.length === 0) {
      return 'No documents in this knowledge base.'
    }

    const grouped: Record<string, { id: string; title: string; filePath: string }[]> = {}
    for (const doc of docs) {
      const cat = doc.category || 'uncategorized'
      if (!grouped[cat]) grouped[cat] = []
      grouped[cat].push({ id: doc.id, title: doc.title, filePath: doc.filePath })
    }

    const lines: string[] = []
    lines.push(`# ${kbName} (${docs.length} documents)`)
    lines.push('')

    const categories = Object.keys(grouped).sort()
    for (const cat of categories) {
      lines.push(`## ${cat} (${grouped[cat].length})`)
      const items = grouped[cat].sort((a, b) => a.title.localeCompare(b.title))
      for (const item of items) {
        lines.push(`  - ${item.title} [${item.id}.md]`)
      }
      lines.push('')
    }

    return lines.join('\n')
  }
}
