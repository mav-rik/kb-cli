import * as fs from 'node:fs'
import { Controller, Cli, Param, CliOption, Description, Optional } from '@moostjs/event-cli'
import { services } from '../services/container.js'
import { composeDocInput } from '../services/wiki-ops.js'
import { AddDocBody, UpdateDocBody } from '../models/api-bodies.as'
import { validateAgainstDto } from '../utils/dto-validate.js'
import type { LintIssue } from '../services/doc-workflow.service.js'

@Controller()
export class DocController {
  private get config() { return services.config }
  private get gateway() { return services.gateway }
  private get parser() { return services.parser }

  @Cli('add')
  @Description('Add a new document')
  async add(
    @Description('Document title') @CliOption('title', 't') title: string,
    @Description('Category') @CliOption('category', 'c') category: string,
    @Description('Tags (comma-separated)') @CliOption('tags') @Optional() tags: string,
    @Description('Content') @CliOption('content', 'body', 'text') @Optional() content: string,
    @Description('File to ingest') @CliOption('file') @Optional() file: string,
    @Description('Read from stdin') @CliOption('stdin') stdin: boolean,
    @Description('Lint only — no write, no index') @CliOption('dry-run') @Optional() dryRun: boolean,
    @Description('Output format') @CliOption('format') @Optional() format: string,
    @Description('Wiki') @CliOption('wiki', 'w') @Optional() wiki: string,
  ): Promise<string> {
    const sources = [file, stdin ? '<stdin>' : undefined, content].filter(Boolean)
    if (sources.length > 1) {
      return `Error: --file, --stdin, and --content are mutually exclusive (got ${sources.length}). Pick one.`
    }
    let rawFileContent: string | undefined
    let rawBody: string | undefined
    if (file) {
      if (!fs.existsSync(file)) return `Error: File "${file}" not found.`
      rawFileContent = fs.readFileSync(file, 'utf-8')
    } else if (stdin) {
      rawBody = await readStdin()
    } else if (content !== undefined) {
      rawBody = content
    }
    const input = composeDocInput({
      parser: this.parser,
      rawFileContent,
      rawBody,
      overrides: {
        title: title || undefined,
        category: category || undefined,
        tags: tags ? tags.split(',').map((t) => t.trim()) : undefined,
      },
    })

    // Same DTO validator that runs on POST /api/docs — single source of
    // truth for "what counts as a valid add body" across CLI and HTTP.
    const validationErr = validateAgainstDto(AddDocBody, input)
    if (validationErr) return `Error: ${validationErr}`

    const ref = this.config.resolveWiki(wiki)
    const ops = this.gateway.getOps(ref)
    try {
      const result = await ops.addDoc(input, { dryRun })
      return formatOpResult('add', result.filename, result.issues, format, dryRun)
    } catch (err: any) {
      return `Error: ${err.message}`
    }
  }

  @Cli('update/:id')
  @Description('Update an existing document')
  async update(
    @Param('id') id: string,
    @Description('New title') @CliOption('title', 't') @Optional() title: string,
    @Description('New category') @CliOption('category', 'c') @Optional() category: string,
    @Description('New tags') @CliOption('tags') @Optional() tags: string,
    @Description('Replace content') @CliOption('content') @Optional() content: string,
    @Description('Append content') @CliOption('append') @Optional() append: string,
    @Description('Replace content from file (parses optional frontmatter)') @CliOption('file') @Optional() file: string,
    @Description('Read replacement content from stdin') @CliOption('stdin') stdin: boolean,
    @Description('Lint only — no write, no index') @CliOption('dry-run') @Optional() dryRun: boolean,
    @Description('Output format') @CliOption('format') @Optional() format: string,
    @Description('Wiki') @CliOption('wiki', 'w') @Optional() wiki: string,
  ): Promise<string> {
    const sources = [file, stdin ? '<stdin>' : undefined, content, append].filter(Boolean)
    if (sources.length > 1) {
      return `Error: --file, --stdin, --content, and --append are mutually exclusive (got ${sources.length}). Pick one.`
    }
    let rawFileContent: string | undefined
    let rawBody: string | undefined
    if (file) {
      if (!fs.existsSync(file)) return `Error: File "${file}" not found.`
      rawFileContent = fs.readFileSync(file, 'utf-8')
    } else if (stdin) {
      rawBody = await readStdin()
    } else if (content !== undefined) {
      rawBody = content
    }
    const input = composeDocInput({
      parser: this.parser,
      rawFileContent,
      rawBody,
      appendBody: append,
      overrides: {
        title: title || undefined,
        category: category || undefined,
        tags: tags ? tags.split(',').map((t) => t.trim()) : undefined,
      },
    })

    // Same DTO validator that runs on PUT /api/docs/:id.
    const validationErr = validateAgainstDto(UpdateDocBody, input)
    if (validationErr) return `Error: ${validationErr}`

    const ref = this.config.resolveWiki(wiki)
    const ops = this.gateway.getOps(ref)
    try {
      const result = await ops.updateDoc(id, input, { dryRun })
      return formatOpResult('update', result.filename, result.issues, format, dryRun)
    } catch (err: any) {
      return `Error: ${err.message}`
    }
  }

  @Cli('delete/:id')
  @Description('Delete a document')
  async delete(
    @Param('id') id: string,
    @Description('Wiki') @CliOption('wiki', 'w') @Optional() wiki: string,
  ): Promise<string> {
    const ref = this.config.resolveWiki(wiki)
    const ops = this.gateway.getOps(ref)
    try {
      const result = await ops.deleteDoc(id)
      const output = [`Deleted: ${result.deleted}`]
      if (result.warnings.length > 0) output.push(...result.warnings.map(w => `Warning: ${w}`))
      return output.join('\n')
    } catch (err: any) {
      return `Error: ${err.message}`
    }
  }

  @Cli('rename/:oldId/:newId')
  @Description('Rename a document and update all links')
  async rename(
    @Param('oldId') oldId: string,
    @Param('newId') newId: string,
    @Description('Wiki') @CliOption('wiki', 'w') @Optional() wiki: string,
  ): Promise<string> {
    const ref = this.config.resolveWiki(wiki)
    const ops = this.gateway.getOps(ref)
    try {
      const result = await ops.rename(oldId, newId)
      const linkInfo = result.linksUpdated > 0 ? ` Updated links in ${result.linksUpdated} documents.` : ''
      return `Renamed: ${oldId}.md → ${newId}.md.${linkInfo}`
    } catch (err: any) {
      return `Error: ${err.message}`
    }
  }

  @Cli('list')
  @Description('List documents')
  async list(
    @Description('Filter by category') @CliOption('category', 'c') @Optional() category: string,
    @Description('Filter by tag') @CliOption('tag') @Optional() tag: string,
    @Description('Output format') @CliOption('format') @Optional() format: string,
    @Description('Wiki') @CliOption('wiki', 'w') @Optional() wiki: string,
  ): Promise<string | object> {
    const ref = this.config.resolveWiki(wiki)
    const ops = this.gateway.getOps(ref)
    const docs = await ops.listDocs({ category, tag })

    if (docs.length === 0) {
      return 'No documents found.'
    }

    if (format === 'json') {
      return JSON.stringify(docs, null, 2)
    }

    const header = 'ID | Title | Category | Tags | Updated'
    const separator = '---|-------|----------|------|--------'
    const rows = docs.map((doc) => {
      const tagsStr = Array.isArray(doc.tags) ? doc.tags.join(', ') : ''
      return `${doc.id} | ${doc.title} | ${doc.category} | ${tagsStr}`
    })

    return [header, separator, ...rows].join('\n')
  }

  @Cli('categories')
  @Description('List all categories in use')
  async categories(
    @Description('Wiki') @CliOption('wiki', 'w') @Optional() wiki: string,
  ): Promise<string> {
    const ref = this.config.resolveWiki(wiki)
    const ops = this.gateway.getOps(ref)
    const cats = await ops.categories()
    if (cats.length === 0) return 'No categories found.'
    return cats.join('\n')
  }
}

function formatOpResult(
  op: 'add' | 'update',
  filename: string,
  issues: LintIssue[],
  format: string | undefined,
  dryRun: boolean,
): string {
  if (format === 'json') {
    return JSON.stringify({ dryRun, op, filename, issues }, null, 2)
  }
  const verb = dryRun
    ? (op === 'add' ? 'Would create' : 'Would update')
    : (op === 'add' ? 'Created' : 'Updated')
  if (issues.length === 0) {
    return dryRun
      ? `${verb}: ${filename}\nDry-run: 0 issues. Safe to ${op}.`
      : `${verb}: ${filename}`
  }
  const lines: string[] = [`${verb}: ${filename}`, '']
  const prefix = dryRun ? 'Dry-run found' : 'Lint:'
  lines.push(`${prefix} ${issues.length} issue${issues.length === 1 ? '' : 's'}:`)
  lines.push('')
  lines.push('Type     | Severity | Details')
  lines.push('---------|----------|---------------------------------')
  // Print each issue type's hint only once — multiple flags of the same
  // type don't need the same pointer repeated for every occurrence.
  const shownHints = new Set<string>()
  for (const issue of issues) {
    const type = issue.type.padEnd(8)
    const severity = issue.severity.padEnd(8)
    lines.push(`${type} | ${severity} | ${issue.details}`)
    if (issue.hint && !shownHints.has(issue.type)) {
      lines.push(`         |          |   ↳ ${issue.hint}`)
      shownHints.add(issue.type)
    }
  }
  return lines.join('\n')
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf-8')
    process.stdin.on('data', (chunk) => {
      data += chunk
    })
    process.stdin.on('end', () => {
      resolve(data)
    })
    if (process.stdin.isTTY) {
      resolve('')
    } else {
      process.stdin.resume()
    }
  })
}
