import * as fs from 'node:fs'
import { Controller, Cli, Param, CliOption, Description, Optional } from '@moostjs/event-cli'
import { services } from '../services/container.js'
import type { UpdatePatch } from '../services/wiki-ops.js'

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
    @Description('Wiki') @CliOption('wiki', 'w') @Optional() wiki: string,
  ): Promise<string> {
    let body = ''
    let fileFrontmatter: { title?: string; category?: string; tags?: string[] } | undefined

    if (file) {
      if (!fs.existsSync(file)) {
        return `Error: File "${file}" not found.`
      }
      const raw = fs.readFileSync(file, 'utf-8')
      if (raw.startsWith('---')) {
        const parsed = this.parser.parse(raw)
        body = parsed.body
        fileFrontmatter = parsed.frontmatter
      } else {
        body = raw
      }
    } else if (stdin) {
      body = await readStdin()
    } else if (content) {
      body = content
    }

    const ref = this.config.resolveWiki(wiki)
    const ops = this.gateway.getOps(ref)
    try {
      const result = await ops.addDoc(
        fileFrontmatter?.title || title,
        fileFrontmatter?.category || category,
        fileFrontmatter?.tags?.length ? fileFrontmatter.tags : tags ? tags.split(',').map(t => t.trim()) : [],
        body,
      )
      return `Created: ${result.filename}`
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
    @Description('Wiki') @CliOption('wiki', 'w') @Optional() wiki: string,
  ): Promise<string> {
    const ref = this.config.resolveWiki(wiki)
    const ops = this.gateway.getOps(ref)
    const patch: UpdatePatch = {}
    if (title !== undefined) patch.title = title
    if (category !== undefined) patch.category = category
    if (tags !== undefined) patch.tags = tags.split(',').map(t => t.trim())
    if (content !== undefined) patch.content = content
    if (append !== undefined) patch.append = append

    try {
      const result = await ops.updateDoc(id, patch)
      return `Updated: ${result.filename}`
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
