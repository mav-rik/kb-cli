import * as fs from 'node:fs'
import { Controller, Cli, Param, CliOption, Description, Optional } from '@moostjs/event-cli'
import { services } from '../services/container.js'
import { composeDocInput } from '../services/wiki-ops.js'
import { AddDocBody, UpdateDocBody, WikiName, DocHandle } from '../models/api-bodies.as'
import { validateAgainstDto } from '../utils/dto-validate.js'
import type { LintIssue } from '../services/doc-workflow.service.js'

@Controller()
export class DocController {
  private get config() { return services.config }
  private get gateway() { return services.gateway }
  private get parser() { return services.parser }

  @Cli('add')
  @Description('Create a new document in the target wiki. The doc id is derived from --title (slugified) — collision with an existing doc fails. After writing, kb runs retrievability lint and surfaces any issues in the response. Use --dry-run to preview lint without committing. Body content comes from --content / --file / --stdin (mutually exclusive); --file additionally parses optional YAML frontmatter from the file.')
  async add(
    @Description('Document title (required). Slugified to derive the doc id. Cannot collide with an existing doc — use `kb update` for that.') @CliOption('title', 't') title: string,
    @Description('Category (required). Free-form string stored in frontmatter; categories are flat (not directories). Run `kb categories` to see what is already in use.') @CliOption('category', 'c') category: string,
    @Description('Comma-separated list of tags, e.g. "auth,jwt,token". Stored as a YAML array in frontmatter.') @CliOption('tags') @Optional() tags: string,
    @Description('Body content as an inline string. Mutually exclusive with --file and --stdin. Aliases: --body, --text. Shell-quote correctly when passing multi-line content.') @CliOption('content', 'body', 'text') @Optional() content: string,
    @Description('Read body (and optional YAML frontmatter) from this file path. Mutually exclusive with --content and --stdin. Frontmatter in the file is merged with --title/--category/--tags overrides.') @CliOption('file') @Optional() file: string,
    @Description('Read body from stdin. Mutually exclusive with --content and --file. Useful for piping generated content from another tool.') @CliOption('stdin') stdin: boolean,
    @Description('Lint the would-be document without writing it or touching the index. Returns the same lint output as a real add — use this to iterate on chunkability before committing.') @CliOption('dry-run') @Optional() dryRun: boolean,
    @Description('Output format. Default: human-readable text. Use --format json for machine-parseable `{ dryRun, op, filename, issues }`.') @CliOption('format') @Optional() format: string,
    @Description('Target wiki name. Defaults to the wiki resolved from `kb.config.json` in the current directory, falling back to the global `defaultWiki`. Run `kb wiki list` to see available wikis.') @CliOption('wiki', 'w') @Optional() wiki: WikiName,
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
  @Description('Update an existing document. All fields are optional; unspecified ones keep their current values. To replace the body, pass --content / --file / --stdin (mutually exclusive); to add to it, use --append. After writing, kb runs retrievability lint and surfaces issues. Use --dry-run to preview without committing.')
  async update(
    @Description('Doc id to update. Accepts canonical id (`foo`), filename (`foo.md`), or relative path (`./foo.md`); they are normalized internally. Run `kb resolve <handle>` if unsure how an input will be interpreted.') @Param('id') id: DocHandle,
    @Description('Replace the title in frontmatter. The doc id does NOT change — use `kb rename` to change the id.') @CliOption('title', 't') @Optional() title: string,
    @Description('Replace the category in frontmatter. Free-form string; categories are flat.') @CliOption('category', 'c') @Optional() category: string,
    @Description('Replace the full tag list (comma-separated). To add a single tag, fetch the current tags first; there is no "add one" mode.') @CliOption('tags') @Optional() tags: string,
    @Description('Replace the body with this inline string. Mutually exclusive with --append, --file, --stdin.') @CliOption('content') @Optional() content: string,
    @Description('Append this string to the existing body (with a blank line separator). Mutually exclusive with --content, --file, --stdin.') @CliOption('append') @Optional() append: string,
    @Description('Replace the body with this file\'s contents. Parses optional YAML frontmatter from the file and merges it with --title/--category/--tags overrides. Mutually exclusive with --content, --append, --stdin.') @CliOption('file') @Optional() file: string,
    @Description('Replace the body with stdin. Mutually exclusive with --content, --append, --file.') @CliOption('stdin') stdin: boolean,
    @Description('Lint the would-be update without writing it or touching the index. Use to iterate on chunkability before committing.') @CliOption('dry-run') @Optional() dryRun: boolean,
    @Description('Output format. Default: human-readable text. Use --format json for machine-parseable `{ dryRun, op, filename, issues }`.') @CliOption('format') @Optional() format: string,
    @Description('Target wiki name. Defaults to the wiki resolved from `kb.config.json` in the current directory, falling back to the global `defaultWiki`. Run `kb wiki list` to see available wikis.') @CliOption('wiki', 'w') @Optional() wiki: WikiName,
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
  @Description('Permanently delete a document. Removes the markdown file from disk and all index/FTS/vector rows. Reports incoming links from other docs as warnings — those links become broken and can be cleaned up with `kb lint --fix`. Irreversible.')
  async delete(
    @Description('Doc id to delete. Accepts canonical id, filename, or `./path` form.') @Param('id') id: DocHandle,
    @Description('Target wiki name. Defaults to the wiki resolved from `kb.config.json` in the current directory, falling back to the global `defaultWiki`. Run `kb wiki list` to see available wikis.') @CliOption('wiki', 'w') @Optional() wiki: WikiName,
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
  @Description('Change a document\'s id. Moves the file, updates the `id:` field in frontmatter, re-indexes the doc, and rewrites every relative markdown link in other docs that pointed at the old filename. Reports the count of docs whose links were updated.')
  async rename(
    @Description('Existing doc id (canonical / filename / `./path` form all accepted).') @Param('oldId') oldId: DocHandle,
    @Description('New doc id. Must not collide with an existing doc.') @Param('newId') newId: DocHandle,
    @Description('Target wiki name. Defaults to the wiki resolved from `kb.config.json` in the current directory, falling back to the global `defaultWiki`. Run `kb wiki list` to see available wikis.') @CliOption('wiki', 'w') @Optional() wiki: WikiName,
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
  @Description('List all documents in the target wiki, optionally filtered. Output is a pipe-separated table: `id | title | category | tags`. Use --format json for an array of objects with full frontmatter.')
  async list(
    @Description('Filter results to a single category (exact match, case-sensitive). Combine with --tag for AND filtering. Run `kb categories` to see what is available.') @CliOption('category', 'c') @Optional() category: string,
    @Description('Filter results to docs that include this tag (exact match). Combine with --category for AND filtering.') @CliOption('tag') @Optional() tag: string,
    @Description('Output format. Default: human-readable pipe-separated table. Use --format json for an array of doc objects.') @CliOption('format') @Optional() format: string,
    @Description('Target wiki name. Defaults to the wiki resolved from `kb.config.json` in the current directory, falling back to the global `defaultWiki`. Run `kb wiki list` to see available wikis.') @CliOption('wiki', 'w') @Optional() wiki: WikiName,
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
  @Description('Print the unique set of categories currently in use across all docs in the target wiki. Use before `kb add` / `kb update` to pick an existing category instead of introducing a near-duplicate.')
  async categories(
    @Description('Target wiki name. Defaults to the wiki resolved from `kb.config.json` in the current directory, falling back to the global `defaultWiki`. Run `kb wiki list` to see available wikis.') @CliOption('wiki', 'w') @Optional() wiki: WikiName,
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
