import { Controller, Cli, Param, CliOption, Description, Optional } from '@moostjs/event-cli'
import { services } from '../services/container.js'
import { toFilename, toDocId } from '../utils/slug.js'
import type { LintIssue, LintRepair } from '../services/doc-workflow.service.js'

const REPAIR_LABELS: Record<LintRepair['type'], string> = {
  drift: 'Reindexed (drift)',
  broken: 'Broken links removed',
  'corrupt-id': 'Corrupt index rows removed',
}

function renderRepairs(repairs: LintRepair[]): string[] {
  if (repairs.length === 0) return []
  const grouped: Record<string, LintRepair[]> = {}
  for (const r of repairs) (grouped[r.type] ||= []).push(r)
  const out: string[] = []
  // Stable order: drift, broken, corrupt-id.
  for (const type of ['drift', 'broken', 'corrupt-id'] as const) {
    const list = grouped[type]
    if (!list || list.length === 0) continue
    out.push(`  ${REPAIR_LABELS[type]} (${list.length}):`)
    for (const r of list) {
      // For drift the file IS the doc id (action is generic); show just the id.
      // For broken/corrupt the file is the affected doc, action carries the detail.
      if (type === 'drift') {
        out.push(`    - ${toDocId(r.file)}`)
      } else {
        out.push(`    - ${toDocId(r.file)} — ${r.action}`)
      }
    }
  }
  return out
}

@Controller()
export class LintController {
  private get config() { return services.config }
  private get gateway() { return services.gateway }

  @Cli('lint')
  @Description('Check knowledge base integrity')
  async lint(
    @Description('Auto-fix issues') @CliOption('fix') fix: boolean,
    @Description('Output format') @CliOption('format') @Optional() format: string,
    @Description('Wiki') @CliOption('wiki', 'w') @Optional() wiki: string,
  ): Promise<string> {
    const ref = this.config.resolveWiki(wiki)
    const ops = this.gateway.getOps(ref)
    let issues: LintIssue[]
    let repairs: LintRepair[] = []

    if (fix) {
      const result = await ops.lintFix()
      issues = await ops.lint()
      // Older `kb serve` versions return `{ fixed }` only; coerce to keep
      // the CLI working against pre-0.3.1 servers.
      repairs = result.repairs ?? []
    } else {
      issues = await ops.lint()
    }

    if (format === 'json') {
      return JSON.stringify({ issues, fixed: repairs.length, repairs }, null, 2)
    }

    if (issues.length === 0) {
      if (fix && repairs.length > 0) {
        const lines = [`All ${repairs.length} issues fixed:`]
        lines.push(...renderRepairs(repairs))
        return lines.join('\n')
      }
      return `Lint: 0 issues found. All clear!`
    }

    const lines: string[] = []
    lines.push(`Lint report (${issues.length} issues found):`)
    lines.push('')
    lines.push('Type     | Severity | File            | Details')
    lines.push('---------|----------|-----------------|----------------------------------')
    // Print each (file, type) hint only once — multiple chunk-merges on the
    // same doc don't need the same pointer repeated for every section.
    const shownHints = new Set<string>()
    for (const issue of issues) {
      const type = issue.type.padEnd(8)
      const severity = issue.severity.padEnd(8)
      const file = issue.file.padEnd(15)
      lines.push(`${type} | ${severity} | ${file} | ${issue.details}`)
      const hintKey = `${issue.file}::${issue.type}`
      if (issue.hint && !shownHints.has(hintKey)) {
        lines.push(`         |          |                 |   ↳ ${issue.hint}`)
        shownHints.add(hintKey)
      }
    }

    if (fix && repairs.length > 0) {
      lines.push('')
      lines.push(`Fixed ${repairs.length} issues:`)
      lines.push(...renderRepairs(repairs))
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
    const isTty = process.stderr.isTTY
    // The remote ops path (CLI auto-routes through a running `kb serve`)
    // can't stream progress over HTTP — print an up-front message so the
    // user doesn't think the CLI is stuck during embedding.
    const routedRemotely = ref.type === 'local' && !!services.localServer.getCached()
    if (routedRemotely) {
      process.stderr.write(
        `Reindexing via running kb serve (PID ${services.localServer.getCached()?.pid ?? '?'}) — this may take a while...\n`,
      )
    }
    const result = await ops.reindex((current, total) => {
      if (isTty) {
        process.stderr.write(`\r[${current}/${total}] reindexing...`)
        if (current === total) process.stderr.write('\n')
      } else {
        process.stderr.write(`[${current}/${total}]\n`)
      }
    })
    return `Reindexed ${result.count} documents in ${result.elapsed}.`
  }

  @Cli('reindex/:id')
  @Description('Rebuild index for a single document')
  async reindexDoc(
    @Param('id') id: string,
    @Description('Wiki') @CliOption('wiki', 'w') @Optional() wiki: string,
  ): Promise<string> {
    const ref = this.config.resolveWiki(wiki)
    const ops = this.gateway.getOps(ref)
    try {
      const result = await ops.reindexDoc(id)
      return `Reindexed: ${result.filename}`
    } catch (err: any) {
      return `Error: ${err.message}`
    }
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
        lines.push(`  - ${item.title} [${toFilename(item.id)}]`)
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
