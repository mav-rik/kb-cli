import { Controller, Cli, Param, CliOption, Description, Optional } from '@moostjs/event-cli'
import { services } from '../services/container.js'
import { toFilename, toDocId } from '../utils/slug.js'
import { WikiName, DocHandle } from '../models/api-bodies.as'
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
  @Description('Audit the target wiki for retrievability and integrity problems: missing required frontmatter fields, broken markdown links, index drift (file content does not match indexed content), corrupt index rows, and per-doc retrievability warnings (short docs, oversized docs, chunk-merge candidates, long paragraphs). Use --fix to auto-repair the safe categories.')
  async lint(
    @Description('Auto-repair safe categories: re-index docs whose content drifted from the index, strip broken outgoing links from frontmatter/body, and delete corrupt index rows. Reports each repair grouped by kind. Does NOT modify content for retrievability warnings (those need author judgment).') @CliOption('fix') fix: boolean,
    @Description('Output format. Default: human-readable table. Use --format json for `{ issues: [...], repairs: [...] }`.') @CliOption('format') @Optional() format: string,
    @Description('Target wiki name. Defaults to the wiki resolved from `kb.config.json` in the current directory, falling back to the global `defaultWiki`. Run `kb wiki list` to see available wikis.') @CliOption('wiki', 'w') @Optional() wiki: WikiName,
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
  @Description('Drop and rebuild the entire index (FTS, vectors, document/link/chunk tables) from the markdown files on disk. Markdown files are the source of truth; the index is rebuilt around them. Slow on large wikis — prints per-file progress. Compacts on-disk size via VACUUM at the end.')
  async reindex(
    @Description('Target wiki name. Defaults to the wiki resolved from `kb.config.json` in the current directory, falling back to the global `defaultWiki`. Run `kb wiki list` to see available wikis.') @CliOption('wiki', 'w') @Optional() wiki: WikiName,
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
  @Description('Re-index a single document: re-chunk by H2/H3, recompute embeddings (skipped per-chunk if contentHash matches), and refresh FTS/vector/link rows for this doc only. Faster than a full reindex when only one doc changed or shows drift.')
  async reindexDoc(
    @Param('id') id: DocHandle,
    @Description('Target wiki name. Defaults to the wiki resolved from `kb.config.json` in the current directory, falling back to the global `defaultWiki`. Run `kb wiki list` to see available wikis.') @CliOption('wiki', 'w') @Optional() wiki: WikiName,
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
  @Description('Print a hierarchical table of contents for the wiki, grouped by category. Use as a starting overview before searching — categories surface naturally and you can spot gaps.')
  async toc(
    @Description('Target wiki name. Defaults to the wiki resolved from `kb.config.json` in the current directory, falling back to the global `defaultWiki`. Run `kb wiki list` to see available wikis.') @CliOption('wiki', 'w') @Optional() wiki: WikiName,
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
  @Description('Show the wiki activity log: every ingest/update/delete/rename plus any manual entries added via `kb log add`. Useful for "what happened in this wiki recently" reviews and agent session retrospectives.')
  async log(
    @Description('Number of most-recent entries to print. Default: 20.') @CliOption('limit', 'n') @Optional() limit: string,
    @Description('Target wiki name. Defaults to the wiki resolved from `kb.config.json` in the current directory, falling back to the global `defaultWiki`. Run `kb wiki list` to see available wikis.') @CliOption('wiki', 'w') @Optional() wiki: WikiName,
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
  @Description('Append a manual entry to the wiki activity log. Intended for agents to record what they did in a session ("ingested doc X because Y", "decided not to add Z because already covered by W") so future sessions have context.')
  async logAdd(
    @Description('Operation type. One of: `ingest` (added/updated content), `query` (a search/read worth remembering), `lint` (a maintenance pass), `note` (free-form). Defaults to `note` if omitted.') @CliOption('op', 'o') op: string,
    @Description('Related doc handle (canonical id / filename / `./path`). Optional — set when the log entry is about a specific doc.') @CliOption('doc', 'd') @Optional() doc: DocHandle,
    @Description('Free-form details / reasoning. Short prose is fine; this is what makes the entry useful to read later.') @CliOption('details', 'm') @Optional() details: string,
    @Description('Target wiki name. Defaults to the wiki resolved from `kb.config.json` in the current directory, falling back to the global `defaultWiki`. Run `kb wiki list` to see available wikis.') @CliOption('wiki', 'w') @Optional() wiki: WikiName,
  ): Promise<string> {
    const ref = this.config.resolveWiki(wiki)
    const ops = this.gateway.getOps(ref)
    await ops.logAdd(op || 'note', doc, details)
    return `Logged: ${op || 'note'}${doc ? ` ${doc}` : ''}${details ? ` (${details})` : ''}`
  }

  @Cli('schema')
  @Description('Print the wiki\'s schema doc (`_schema.md`, if present) — a top-level description of what this wiki covers, categories in use, and conventions. Run `kb schema update` to regenerate it from current content.')
  async schemaRead(
    @Description('Target wiki name. Defaults to the wiki resolved from `kb.config.json` in the current directory, falling back to the global `defaultWiki`. Run `kb wiki list` to see available wikis.') @CliOption('wiki', 'w') @Optional() wiki: WikiName,
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
  @Description('Regenerate `_schema.md` from the current set of docs: scans categories, doc counts per category, and recently updated docs. Overwrites the existing schema file.')
  async schemaUpdate(
    @Description('Target wiki name. Defaults to the wiki resolved from `kb.config.json` in the current directory, falling back to the global `defaultWiki`. Run `kb wiki list` to see available wikis.') @CliOption('wiki', 'w') @Optional() wiki: WikiName,
  ): Promise<string> {
    const ref = this.config.resolveWiki(wiki)
    const ops = this.gateway.getOps(ref)
    await ops.schemaUpdate()
    return `Schema updated.`
  }
}
