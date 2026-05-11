import * as fs from 'node:fs'
import { Controller, Cli, Param, CliOption, Description, Optional } from '@moostjs/event-cli'
import { services } from '../services/container.js'
import { DocFrontmatter } from '../services/parser.service.js'
import { slugify, toFilename, toDocId, today } from '../utils/slug.js'

@Controller()
export class DocController {
  private get config() { return services.config }
  private get storage() { return services.storage }
  private get parser() { return services.parser }
  private get index() { return services.index }
  private get workflow() { return services.docWorkflow }
  private get log() { return services.activityLog }

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
    const kbName = this.config.resolveWiki(wiki)
    const id = slugify(title)
    const filename = `${id}.md`

    if (this.storage.docExists(kbName, filename)) {
      return `Error: Document "${filename}" already exists in wiki "${kbName}".`
    }

    let body = ''
    let fileFrontmatter: Partial<DocFrontmatter> | undefined

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

    const frontmatter: DocFrontmatter = {
      id,
      title: fileFrontmatter?.title || title,
      category: fileFrontmatter?.category || category,
      tags: fileFrontmatter?.tags?.length
        ? fileFrontmatter.tags
        : tags
          ? tags.split(',').map((t) => t.trim())
          : [],
      created: today(),
      updated: today(),
    }

    this.storage.writeDoc(kbName, filename, frontmatter, body)

    const links = this.parser.extractLinks(body)
    const warnings: string[] = []
    for (const link of links) {
      if (!this.storage.docExists(kbName, link.target)) {
        warnings.push(`Warning: Broken link to "${link.target}" (target does not exist)`)
      }
    }

    await this.workflow.indexAndEmbed(kbName, id, frontmatter, body, filename)
    this.log.log(kbName, 'add', id, `category=${frontmatter.category}`)

    const output = [`Created: ${filename}`]
    output.push(...warnings)
    return output.join('\n')
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
    const kbName = this.config.resolveWiki(wiki)
    const filename = toFilename(id)
    const docId = toDocId(filename)

    if (!this.storage.docExists(kbName, filename)) {
      return `Error: Document "${filename}" not found in wiki "${kbName}".`
    }

    const doc = this.storage.readDoc(kbName, filename)

    const frontmatter: DocFrontmatter = {
      ...doc.frontmatter,
      ...(title !== undefined && { title }),
      ...(category !== undefined && { category }),
      ...(tags !== undefined && { tags: tags.split(',').map((t) => t.trim()) }),
      updated: today(),
    }

    let body = doc.body
    if (content !== undefined) {
      body = content
    } else if (append !== undefined) {
      body = body + append
    }

    this.storage.writeDoc(kbName, filename, frontmatter, body)
    await this.workflow.indexAndEmbed(kbName, docId, frontmatter, body, filename)
    this.log.log(kbName, 'update', docId)

    return `Updated: ${filename}`
  }

  @Cli('delete/:id')
  @Description('Delete a document')
  async delete(
    @Param('id') id: string,
    @Description('Wiki') @CliOption('wiki', 'w') @Optional() wiki: string,
  ): Promise<string> {
    const kbName = this.config.resolveWiki(wiki)
    const filename = toFilename(id)
    const docId = toDocId(filename)

    if (!this.storage.docExists(kbName, filename)) {
      return `Error: Document "${filename}" not found in wiki "${kbName}".`
    }

    const backlinks = await this.index.getLinksTo(kbName, docId)
    const warnings: string[] = []
    if (backlinks.length > 0) {
      const sources = backlinks.map((l) => `${l.fromId}.md`)
      warnings.push(
        `Warning: ${backlinks.length} document(s) have broken links to ${filename}: ${sources.join(', ')}`,
      )
    }

    this.storage.deleteDoc(kbName, filename)
    await this.workflow.removeFromIndex(kbName, docId)
    this.log.log(kbName, 'delete', docId)

    const output = [`Deleted: ${filename}`]
    output.push(...warnings)
    return output.join('\n')
  }

  @Cli('rename/:oldId/:newId')
  @Description('Rename a document and update all links')
  async rename(
    @Param('oldId') oldId: string,
    @Param('newId') newId: string,
    @Description('Wiki') @CliOption('wiki', 'w') @Optional() wiki: string,
  ): Promise<string> {
    const kbName = this.config.resolveWiki(wiki)
    const oldFilename = `${oldId}.md`
    const newFilename = `${newId}.md`

    if (!this.storage.docExists(kbName, oldFilename)) {
      return `Error: Document "${oldFilename}" not found in wiki "${kbName}".`
    }

    if (this.storage.docExists(kbName, newFilename)) {
      return `Error: Document "${newFilename}" already exists in wiki "${kbName}".`
    }

    const modifiedCount = await this.workflow.rename(kbName, oldId, newId, oldFilename, newFilename)
    this.log.log(kbName, 'rename', newId, `from=${oldId}`)

    const linkInfo = modifiedCount > 0
      ? ` Updated links in ${modifiedCount} documents.`
      : ''
    return `Renamed: ${oldFilename} → ${newFilename}.${linkInfo}`
  }

  @Cli('list')
  @Description('List documents')
  async list(
    @Description('Filter by category') @CliOption('category', 'c') @Optional() category: string,
    @Description('Filter by tag') @CliOption('tag') @Optional() tag: string,
    @Description('Output format') @CliOption('format') @Optional() format: string,
    @Description('Wiki') @CliOption('wiki', 'w') @Optional() wiki: string,
  ): Promise<string | object> {
    const kbName = this.config.resolveWiki(wiki)

    const docs = await this.index.listDocs(kbName, { category, tag })

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
      const updated = doc.updatedAt ? new Date(doc.updatedAt).toISOString().split('T')[0] : ''
      return `${doc.id} | ${doc.title} | ${doc.category} | ${tagsStr} | ${updated}`
    })

    return [header, separator, ...rows].join('\n')
  }

  @Cli('categories')
  @Description('List all categories in use')
  async categories(
    @Description('Wiki') @CliOption('wiki', 'w') @Optional() wiki: string,
  ): Promise<string> {
    const kbName = this.config.resolveWiki(wiki)
    const docs = await this.index.listDocs(kbName)
    const cats = [...new Set(docs.map((d) => d.category).filter(Boolean))].sort()
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
