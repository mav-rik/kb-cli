import * as fs from 'node:fs'
import { Controller, Cli, Param, CliOption, Description, Optional } from '@moostjs/event-cli'
import { services } from '../services/container.js'
import { DocFrontmatter } from '../services/parser.service.js'
import { slugify, toFilename, toDocId, today } from '../utils/slug.js'
import { contentHash } from '../utils/hash.js'

@Controller()
export class DocController {
  private get config() { return services.config }
  private get storage() { return services.storage }
  private get parser() { return services.parser }
  private get index() { return services.index }
  private get linker() { return services.linker }
  private get embedding() { return services.embedding }
  private get vector() { return services.vector }
  private get fts() { return services.fts }

  private async indexAndEmbed(kb: string, docId: string, frontmatter: DocFrontmatter, body: string, filename: string): Promise<void> {
    const links = this.parser.extractLinks(body)

    await this.index.upsertDoc(kb, {
      id: docId,
      title: frontmatter.title,
      category: frontmatter.category,
      tags: frontmatter.tags,
      filePath: filename,
      contentHash: contentHash(body),
    })

    await this.index.upsertLinks(
      kb,
      docId,
      links.map((l) => ({ toId: toDocId(l.target), linkText: l.text })),
    )

    this.fts.upsert(kb, docId, frontmatter.title, frontmatter.tags || [], body)

    this.vector.ensureTables(kb)
    const vec = await this.embedding.embed(body)
    this.vector.upsertVec(kb, docId, vec)
  }

  @Cli('add')
  @Description('Add a new document')
  async add(
    @Description('Document title') @CliOption('title', 't') title: string,
    @Description('Category') @CliOption('category', 'c') category: string,
    @Description('Tags (comma-separated)') @CliOption('tags') @Optional() tags: string,
    @Description('Content') @CliOption('content') @Optional() content: string,
    @Description('File to ingest') @CliOption('file') @Optional() file: string,
    @Description('Read from stdin') @CliOption('stdin') stdin: boolean,
    @Description('Knowledge base') @CliOption('kb') @Optional() kb: string,
  ): Promise<string> {
    const kbName = this.config.resolveKb(kb)
    const id = slugify(title)
    const filename = `${id}.md`

    if (this.storage.docExists(kbName, filename)) {
      return `Error: Document "${filename}" already exists in KB "${kbName}".`
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

    await this.indexAndEmbed(kbName, id, frontmatter, body, filename)

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
    @Description('Knowledge base') @CliOption('kb') @Optional() kb: string,
  ): Promise<string> {
    const kbName = this.config.resolveKb(kb)
    const filename = toFilename(id)
    const docId = toDocId(filename)

    if (!this.storage.docExists(kbName, filename)) {
      return `Error: Document "${filename}" not found in KB "${kbName}".`
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
    await this.indexAndEmbed(kbName, docId, frontmatter, body, filename)

    return `Updated: ${filename}`
  }

  @Cli('delete/:id')
  @Description('Delete a document')
  async delete(
    @Param('id') id: string,
    @Description('Knowledge base') @CliOption('kb') @Optional() kb: string,
  ): Promise<string> {
    const kbName = this.config.resolveKb(kb)
    const filename = toFilename(id)
    const docId = toDocId(filename)

    if (!this.storage.docExists(kbName, filename)) {
      return `Error: Document "${filename}" not found in KB "${kbName}".`
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
    await this.index.deleteDoc(kbName, docId)
    this.vector.ensureTables(kbName)
    this.vector.deleteVec(kbName, docId)
    this.fts.delete(kbName, docId)

    const output = [`Deleted: ${filename}`]
    output.push(...warnings)
    return output.join('\n')
  }

  @Cli('rename/:oldId/:newId')
  @Description('Rename a document and update all links')
  async rename(
    @Param('oldId') oldId: string,
    @Param('newId') newId: string,
    @Description('Knowledge base') @CliOption('kb') @Optional() kb: string,
  ): Promise<string> {
    const kbName = this.config.resolveKb(kb)
    const oldFilename = `${oldId}.md`
    const newFilename = `${newId}.md`

    if (!this.storage.docExists(kbName, oldFilename)) {
      return `Error: Document "${oldFilename}" not found in KB "${kbName}".`
    }

    if (this.storage.docExists(kbName, newFilename)) {
      return `Error: Document "${newFilename}" already exists in KB "${kbName}".`
    }

    const doc = this.storage.readDoc(kbName, oldFilename)

    const frontmatter = {
      ...doc.frontmatter,
      id: newId,
      updated: today(),
    }

    this.storage.writeDoc(kbName, newFilename, frontmatter, doc.body)
    this.storage.deleteDoc(kbName, oldFilename)

    const modifiedCount = await this.linker.updateLinksAcrossKb(kbName, oldFilename, newFilename)

    await this.index.deleteDoc(kbName, oldId)
    this.fts.delete(kbName, oldId)
    await this.indexAndEmbed(kbName, newId, frontmatter, doc.body, newFilename)

    // Update index for docs whose links now point to newId
    const files = this.storage.listFiles(kbName)
    for (const file of files) {
      if (file === newFilename) continue
      const fileDoc = this.storage.readDoc(kbName, file)
      const fileLinks = this.parser.extractLinks(fileDoc.body)
      if (fileLinks.some((l) => l.target === newFilename)) {
        const fileId = toDocId(file)
        await this.index.upsertLinks(
          kbName,
          fileId,
          fileLinks.map((l) => ({ toId: toDocId(l.target), linkText: l.text })),
        )
      }
    }

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
    @Description('Knowledge base') @CliOption('kb') @Optional() kb: string,
  ): Promise<string | object> {
    const kbName = this.config.resolveKb(kb)

    const docs = await this.index.listDocs(kbName, { category, tag })

    if (docs.length === 0) {
      return 'No documents found.'
    }

    if (format === 'json') {
      return docs
    }

    const header = 'ID | Title | Category | Tags | Updated'
    const separator = '---|-------|----------|------|--------'
    const rows = docs.map((doc) => {
      const tagsStr = doc.tags ? (Array.isArray(doc.tags) ? doc.tags.join(', ') : doc.tags) : ''
      const updated = doc.updatedAt ? new Date(doc.updatedAt).toISOString().split('T')[0] : ''
      return `${doc.id} | ${doc.title} | ${doc.category} | ${tagsStr} | ${updated}`
    })

    return [header, separator, ...rows].join('\n')
  }

  @Cli('categories')
  @Description('List all categories in use')
  async categories(
    @Description('Knowledge base') @CliOption('kb') @Optional() kb: string,
  ): Promise<string> {
    const kbName = this.config.resolveKb(kb)
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
