import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Controller, Param } from 'moost'
import { Get, Post, Put, Delete, Body, Query, SetStatus } from '@moostjs/event-http'
import { services } from '../services/container.js'
import { slugify, toFilename, toDocId, today } from '../utils/slug.js'
import { DocFrontmatter } from '../services/parser.service.js'

function parseLineRange(text: string, totalLines: number): { start: number; end: number } {
  const parts = text.split('-')
  const start = Math.max(1, parseInt(parts[0], 10) || 1)
  const end = Math.min(totalLines, parseInt(parts[1], 10) || totalLines)
  return { start, end }
}

function sliceLines(content: string, lines?: string): string {
  if (!lines) return content
  const allLines = content.split('\n')
  const { start, end } = parseLineRange(lines, allLines.length)
  return allLines.slice(start - 1, end).join('\n')
}

@Controller('api')
export class ApiController {
  private get config() { return services.config }
  private get storage() { return services.storage }
  private get index() { return services.index }
  private get linker() { return services.linker }
  private get searchService() { return services.search }
  private get workflow() { return services.docWorkflow }
  private get wikiMgmt() { return services.wikiManagement }

  // ─── Search ───────────────────────────────────────────────────────────────

  @Get('search')
  async search(@Query('q') q: string, @Query('limit') limit: string, @Query('wiki') wiki: string) {
    const resolvedWiki = this.config.resolveWiki(wiki)
    const parsedLimit = limit ? parseInt(limit, 10) : 10
    if (!q) return { error: 'Query parameter "q" is required' }
    return this.searchService.search(resolvedWiki, q, parsedLimit)
  }

  // ─── Read ─────────────────────────────────────────────────────────────────

  @Get('read/:filename')
  async read(@Param('filename') filename: string, @Query('wiki') wiki: string, @Query('lines') lines: string, @Query('format') format: string) {
    const resolvedWiki = this.config.resolveWiki(wiki)
    const targetPath = toFilename(filename)

    if (!this.storage.docExists(resolvedWiki, targetPath)) {
      return { error: `Document "${targetPath}" not found in wiki "${resolvedWiki}".` }
    }

    if (format === 'json') {
      const doc = this.storage.readDoc(resolvedWiki, targetPath)
      return { meta: doc.frontmatter, content: sliceLines(doc.body, lines), links: doc.links }
    }

    // Default: return raw markdown
    return sliceLines(this.storage.readRaw(resolvedWiki, targetPath), lines)
  }

  // ─── Documents CRUD ───────────────────────────────────────────────────────

  @Post('docs')
  @SetStatus(201)
  async addDoc(@Body() body: { title: string; category: string; tags?: string[]; content: string; wiki?: string }) {
    const wikiName = this.config.resolveWiki(body.wiki)
    const id = slugify(body.title)
    const filename = `${id}.md`

    if (this.storage.docExists(wikiName, filename)) {
      return { error: `Document "${filename}" already exists in wiki "${wikiName}".` }
    }

    const frontmatter: DocFrontmatter = {
      id,
      title: body.title,
      category: body.category,
      tags: body.tags || [],
      created: today(),
      updated: today(),
    }

    this.storage.writeDoc(wikiName, filename, frontmatter, body.content || '')
    await this.workflow.indexAndEmbed(wikiName, id, frontmatter, body.content || '', filename)

    return { id, filename }
  }

  @Put('docs/:id')
  async updateDoc(@Param('id') id: string, @Body() body: { title?: string; category?: string; tags?: string[]; content?: string; append?: string; wiki?: string }) {
    const wikiName = this.config.resolveWiki(body.wiki)
    const filename = toFilename(id)
    const docId = toDocId(filename)

    if (!this.storage.docExists(wikiName, filename)) {
      return { error: `Document "${filename}" not found in wiki "${wikiName}".` }
    }

    const doc = this.storage.readDoc(wikiName, filename)

    const frontmatter: DocFrontmatter = {
      ...doc.frontmatter,
      ...(body.title !== undefined && { title: body.title }),
      ...(body.category !== undefined && { category: body.category }),
      ...(body.tags !== undefined && { tags: body.tags }),
      updated: today(),
    }

    let docBody = doc.body
    if (body.content !== undefined) {
      docBody = body.content
    } else if (body.append !== undefined) {
      docBody = docBody + body.append
    }

    this.storage.writeDoc(wikiName, filename, frontmatter, docBody)
    await this.workflow.indexAndEmbed(wikiName, docId, frontmatter, docBody, filename)

    return { id: docId, filename }
  }

  @Delete('docs/:id')
  async deleteDoc(@Param('id') id: string, @Query('wiki') wiki: string) {
    const wikiName = this.config.resolveWiki(wiki)
    const filename = toFilename(id)
    const docId = toDocId(filename)

    if (!this.storage.docExists(wikiName, filename)) {
      return { error: `Document "${filename}" not found in wiki "${wikiName}".` }
    }

    const backlinks = await this.index.getLinksTo(wikiName, docId)
    const warnings: string[] = []
    if (backlinks.length > 0) {
      const sources = backlinks.map((l) => `${l.fromId}.md`)
      warnings.push(`${backlinks.length} document(s) have broken links to ${filename}: ${sources.join(', ')}`)
    }

    this.storage.deleteDoc(wikiName, filename)
    await this.workflow.removeFromIndex(wikiName, docId)

    return { deleted: filename, warnings }
  }

  @Get('docs/:id/related')
  async related(@Param('id') id: string, @Query('wiki') wiki: string, @Query('limit') limit: string) {
    const resolvedWiki = this.config.resolveWiki(wiki)
    const parsedLimit = limit ? parseInt(limit, 10) : 10
    const filename = toFilename(id)
    const docId = toDocId(filename)

    if (!this.storage.docExists(resolvedWiki, filename)) {
      return { error: `Document "${filename}" not found in wiki "${resolvedWiki}".` }
    }

    const scored = await this.workflow.findRelated(resolvedWiki, docId, filename, parsedLimit)
    return this.searchService.buildResults(resolvedWiki, scored)
  }

  @Post('docs/:id/rename')
  async renameDoc(@Param('id') id: string, @Body() body: { newId: string; wiki?: string }) {
    const wikiName = this.config.resolveWiki(body.wiki)
    const oldFilename = toFilename(id)
    const newId = body.newId
    const newFilename = toFilename(newId)

    if (!this.storage.docExists(wikiName, oldFilename)) {
      return { error: `Document "${oldFilename}" not found in wiki "${wikiName}".` }
    }

    if (this.storage.docExists(wikiName, newFilename)) {
      return { error: `Document "${newFilename}" already exists in wiki "${wikiName}".` }
    }

    const doc = this.storage.readDoc(wikiName, oldFilename)
    const frontmatter = { ...doc.frontmatter, id: newId, updated: today() }

    this.storage.writeDoc(wikiName, newFilename, frontmatter, doc.body)
    this.storage.deleteDoc(wikiName, oldFilename)

    const linksUpdated = await this.linker.updateLinksAcrossKb(wikiName, oldFilename, newFilename)

    await this.workflow.removeFromIndex(wikiName, toDocId(oldFilename))
    await this.workflow.indexAndEmbed(wikiName, newId, frontmatter, doc.body, newFilename)

    // Re-index links for docs that now reference the new filename
    const files = this.storage.listFiles(wikiName)
    for (const file of files) {
      if (file === newFilename) continue
      const fileDoc = this.storage.readDoc(wikiName, file)
      const fileLinks = services.parser.extractLinks(fileDoc.body)
      if (fileLinks.some((l) => l.target === newFilename)) {
        const fileId = toDocId(file)
        await this.index.upsertLinks(
          wikiName,
          fileId,
          fileLinks.map((l) => ({ toId: toDocId(l.target), linkText: l.text })),
        )
      }
    }

    return { oldId: id, newId, linksUpdated }
  }

  @Get('docs')
  async listDocs(@Query('wiki') wiki: string, @Query('category') category: string, @Query('tag') tag: string) {
    const wikiName = this.config.resolveWiki(wiki)
    return this.index.listDocs(wikiName, { category, tag })
  }

  // ─── Categories ───────────────────────────────────────────────────────────

  @Get('categories')
  async categories(@Query('wiki') wiki: string) {
    const wikiName = this.config.resolveWiki(wiki)
    const docs = await this.index.listDocs(wikiName)
    return [...new Set(docs.map((d) => d.category).filter(Boolean))].sort()
  }

  // ─── Wikis ────────────────────────────────────────────────────────────────

  @Get('wiki')
  listWikis() {
    return this.wikiMgmt.list()
  }

  @Post('wiki')
  @SetStatus(201)
  createWiki(@Body() body: { name: string }) {
    return this.wikiMgmt.create(body.name)
  }

  @Delete('wiki/:name')
  deleteWiki(@Param('name') name: string) {
    return this.wikiMgmt.delete(name)
  }

  // ─── Lint ─────────────────────────────────────────────────────────────────

  @Get('lint')
  async lint(@Query('wiki') wiki: string) {
    const wikiName = this.config.resolveWiki(wiki)
    return this.workflow.lint(wikiName)
  }

  @Post('lint/fix')
  async lintFix(@Query('wiki') wiki: string) {
    const wikiName = this.config.resolveWiki(wiki)
    const issues = await this.workflow.lint(wikiName)
    const fixed = await this.workflow.lintFix(wikiName, issues)
    return { fixed }
  }

  // ─── Reindex ──────────────────────────────────────────────────────────────

  @Post('reindex')
  async reindex(@Query('wiki') wiki: string) {
    const wikiName = this.config.resolveWiki(wiki)
    return this.workflow.reindex(wikiName)
  }

  // ─── Table of Contents ────────────────────────────────────────────────────

  @Get('toc')
  async toc(@Query('wiki') wiki: string) {
    const wikiName = this.config.resolveWiki(wiki)
    const docs = await this.index.listDocs(wikiName)

    const grouped: Record<string, { id: string; title: string; filePath: string }[]> = {}
    for (const doc of docs) {
      const cat = doc.category || 'uncategorized'
      if (!grouped[cat]) grouped[cat] = []
      grouped[cat].push({ id: doc.id, title: doc.title, filePath: doc.filePath })
    }

    return { categories: grouped }
  }

  // ─── Activity Log ──────────────────────────────────────────────────────────

  @Get('log')
  log(@Query('wiki') wiki: string, @Query('limit') limit: string) {
    const wikiName = this.config.resolveWiki(wiki)
    const parsedLimit = limit ? parseInt(limit, 10) : 20
    return services.activityLog.recent(wikiName, parsedLimit)
  }

  // ─── Wiki Use ──────────────────────────────────────────────────────────────

  @Put('wiki/use/:name')
  wikiUse(@Param('name') name: string) {
    if (!this.wikiMgmt.exists(name)) {
      return { error: `Wiki "${name}" does not exist.` }
    }
    this.config.set('defaultWiki', name)
    return { defaultWiki: name }
  }

  // ─── Skill ────────────────────────────────────────────────────────────────

  @Get('skill')
  skill(@Query('workflow') workflow: string) {
    const __dirname = path.dirname(fileURLToPath(import.meta.url))
    const contentDir = path.resolve(__dirname, '..', 'content')
    const filename = workflow ? `skill-${workflow}.md` : 'skill.md'
    const filePath = path.join(contentDir, filename)
    if (!fs.existsSync(filePath)) {
      return { error: `Unknown workflow "${workflow}". Available: ingest, search, update, lint` }
    }
    return fs.readFileSync(filePath, 'utf-8')
  }

  // ─── Schema ────────────────────────────────────────────────────────────────

  @Get('schema')
  schemaRead(@Query('wiki') wiki: string) {
    const wikiName = this.config.resolveWiki(wiki)
    const content = services.schema.read(wikiName)
    if (!content) return { error: 'No schema found. Call POST /api/schema to generate.' }
    return content
  }

  @Post('schema')
  async schemaUpdate(@Query('wiki') wiki: string) {
    const wikiName = this.config.resolveWiki(wiki)
    await services.schema.update(wikiName)
    return { updated: true, wiki: wikiName }
  }
}
