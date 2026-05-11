import { Controller, Cli, CliOption, Description, Optional } from '@moostjs/event-cli'
import { services } from '../services/container.js'

@Controller()
export class LintController {
  private get config() { return services.config }
  private get workflow() { return services.docWorkflow }
  private get schema() { return services.schema }

  @Cli('lint')
  @Description('Check knowledge base integrity')
  async lint(
    @Description('Auto-fix issues') @CliOption('fix') fix: boolean,
    @Description('Knowledge base') @CliOption('kb') @Optional() kb: string,
  ): Promise<string> {
    const kbName = this.config.resolveKb(kb)
    const issues = await this.workflow.lint(kbName)

    let fixedCount = 0
    if (fix) {
      fixedCount = await this.workflow.lintFix(kbName, issues)
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

    const result = await this.workflow.reindex(kbName, (current, total) => {
      process.stderr.write(`Reindexing... ${current}/${total}\r`)
    })

    if (result.count > 0) {
      process.stderr.write('\n')
    }

    return `Reindexed ${result.count} documents in ${result.elapsed}.`
  }

  @Cli('toc')
  @Description('Display table of contents for a knowledge base')
  async toc(
    @Description('Knowledge base') @CliOption('kb') @Optional() kb: string,
  ): Promise<string> {
    const kbName = this.config.resolveKb(kb)

    const docs = await services.index.listDocs(kbName)

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

  @Cli('log')
  @Description('Show recent activity log')
  log(
    @Description('Number of entries') @CliOption('limit', 'n') @Optional() limit: string,
    @Description('Knowledge base') @CliOption('kb') @Optional() kb: string,
  ): string {
    const kbName = this.config.resolveKb(kb)
    const parsedLimit = limit ? parseInt(limit, 10) : 20
    const entries = services.activityLog.recent(kbName, parsedLimit)

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

  @Cli('schema')
  @Description('Show knowledge base schema')
  schemaRead(
    @Description('Knowledge base') @CliOption('kb') @Optional() kb: string,
  ): string {
    const kbName = this.config.resolveKb(kb)
    const content = this.schema.read(kbName)
    if (!content) {
      return `No schema found for "${kbName}". Run \`aimem schema update\` to generate.`
    }
    return content
  }

  @Cli('schema/update')
  @Description('Regenerate knowledge base schema')
  async schemaUpdate(
    @Description('Knowledge base') @CliOption('kb') @Optional() kb: string,
  ): Promise<string> {
    const kbName = this.config.resolveKb(kb)
    await this.schema.update(kbName)
    return `Schema updated for "${kbName}".`
  }
}
