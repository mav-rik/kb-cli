import { Controller, Cli, CliOption, Description, Optional } from '@moostjs/event-cli'
import { services } from '../services/container.js'
import type { LintIssue } from '../services/doc-workflow.service.js'

@Controller()
export class LintController {
  private get config() { return services.config }
  private get gateway() { return services.gateway }

  @Cli('lint')
  @Description('Check knowledge base integrity')
  async lint(
    @Description('Auto-fix issues') @CliOption('fix') fix: boolean,
    @Description('Wiki') @CliOption('wiki', 'w') @Optional() wiki: string,
  ): Promise<string> {
    const ref = this.config.resolveWiki(wiki)
    const ops = this.gateway.getOps(ref)
    let issues: LintIssue[]
    let fixedCount = 0

    if (fix) {
      const result = await ops.lintFix()
      issues = await ops.lint()
      fixedCount = result.fixed
    } else {
      issues = await ops.lint()
    }

    if (issues.length === 0) {
      if (fix && fixedCount > 0) {
        return `All ${fixedCount} issues fixed.`
      }
      return `Lint: 0 issues found. All clear!`
    }

    const lines: string[] = []
    lines.push(`Lint report (${issues.length} issues found):`)
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
    @Description('Wiki') @CliOption('wiki', 'w') @Optional() wiki: string,
  ): Promise<string> {
    const ref = this.config.resolveWiki(wiki)
    const ops = this.gateway.getOps(ref)
    const result = await ops.reindex()
    return `Reindexed ${result.count} documents in ${result.elapsed}.`
  }

  @Cli('toc')
  @Description('Display table of contents for a knowledge base')
  async toc(
    @Description('Wiki') @CliOption('wiki', 'w') @Optional() wiki: string,
  ): Promise<string> {
    const ref = this.config.resolveWiki(wiki)
    const ops = this.gateway.getOps(ref)
    const result = await ops.toc()

    const allDocs = Object.values(result.categories).flat()
    if (allDocs.length === 0) {
      return 'No documents in this knowledge base.'
    }

    const lines: string[] = []
    lines.push(`# Table of Contents (${allDocs.length} documents)`)
    lines.push('')

    const categories = Object.keys(result.categories).sort()
    for (const cat of categories) {
      const items = result.categories[cat]
      lines.push(`## ${cat} (${items.length})`)
      const sorted = items.sort((a, b) => a.title.localeCompare(b.title))
      for (const item of sorted) {
        lines.push(`  - ${item.title} [${item.id}.md]`)
      }
      lines.push('')
    }

    return lines.join('\n')
  }

  @Cli('log')
  @Description('Show recent activity log')
  async log(
    @Description('Number of entries') @CliOption('limit', 'n') @Optional() limit: string,
    @Description('Wiki') @CliOption('wiki', 'w') @Optional() wiki: string,
  ): Promise<string> {
    const ref = this.config.resolveWiki(wiki)
    const ops = this.gateway.getOps(ref)
    const parsedLimit = limit ? parseInt(limit, 10) : 20
    const entries = await ops.log(parsedLimit)

    if (entries.length === 0) {
      return 'No activity recorded.'
    }

    const lines = entries.map((e) => {
      const doc = e.docId ? ` ${e.docId}` : ''
      const details = e.details ? ` (${e.details})` : ''
      return `${e.timestamp} | ${e.operation.padEnd(8)}${doc}${details}`
    })

    return lines.join('\n')
  }

  @Cli('log/add')
  @Description('Add a manual log entry (for agent session summaries)')
  async logAdd(
    @Description('Operation type (ingest, query, lint, note)') @CliOption('op', 'o') op: string,
    @Description('Related document ID') @CliOption('doc', 'd') @Optional() doc: string,
    @Description('Details / reasoning') @CliOption('details', 'm') @Optional() details: string,
    @Description('Wiki') @CliOption('wiki', 'w') @Optional() wiki: string,
  ): Promise<string> {
    const ref = this.config.resolveWiki(wiki)
    const ops = this.gateway.getOps(ref)
    await ops.logAdd(op || 'note', doc, details)
    return `Logged: ${op || 'note'}${doc ? ` ${doc}` : ''}${details ? ` (${details})` : ''}`
  }

  @Cli('schema')
  @Description('Show knowledge base schema')
  async schemaRead(
    @Description('Wiki') @CliOption('wiki', 'w') @Optional() wiki: string,
  ): Promise<string> {
    const ref = this.config.resolveWiki(wiki)
    const ops = this.gateway.getOps(ref)
    const content = await ops.schema()
    if (!content) {
      return `No schema found. Run \`kb schema update\` to generate.`
    }
    if (typeof content === 'object') {
      return JSON.stringify(content, null, 2)
    }
    return content
  }

  @Cli('schema/update')
  @Description('Regenerate knowledge base schema')
  async schemaUpdate(
    @Description('Wiki') @CliOption('wiki', 'w') @Optional() wiki: string,
  ): Promise<string> {
    const ref = this.config.resolveWiki(wiki)
    const ops = this.gateway.getOps(ref)
    await ops.schemaUpdate()
    return `Schema updated.`
  }
}
