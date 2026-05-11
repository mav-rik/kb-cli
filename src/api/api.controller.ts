import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Controller, Param } from 'moost'
import { Get, Post, Put, Delete, Body, Query, SetStatus } from '@moostjs/event-http'
import { services } from '../services/container.js'
import { slugify, toFilename, toDocId, today } from '../utils/slug.js'
import { DocFrontmatter } from '../services/parser.service.js'

@Controller('api')
export class ApiController {
  private get config() { return services.config }
  private get storage() { return services.storage }
  private get index() { return services.index }
  private get linker() { return services.linker }
  private get searchService() { return services.search }
  private get workflow() { return services.docWorkflow }
  private get kbMgmt() { return services.kbManagement }

  // ─── Search ───────────────────────────────────────────────────────────────

  @Get('search')
  async search(@Query('q') q: string, @Query('limit') limit: string, @Query('kb') kb: string) {
    const resolvedKb = this.config.resolveKb(kb)
    const parsedLimit = limit ? parseInt(limit, 10) : 10
    if (!q) return { error: 'Query parameter "q" is required' }
    return this.searchService.search(resolvedKb, q, parsedLimit)
  }

  // ─── Read ─────────────────────────────────────────────────────────────────

  @Get('read/:filename')
  async read(@Param('filename') filename: string, @Query('kb') kb: string, @Query('lines') lines: string, @Query('format') format: string) {
    const resolvedKb = this.config.resolveKb(kb)
    const targetPath = toFilename(filename)

    if (!this.storage.docExists(resolvedKb, targetPath)) {
      return { error: `Document "${targetPath}" not found in KB "${resolvedKb}".` }
    }

    if (format === 'json') {
      const doc = this.storage.readDoc(resolvedKb, targetPath)
      let bodyContent = doc.body
      if (lines) {
        const bodyLines = doc.body.split('\n')
        const parts = lines.split('-')
        const start = Math.max(1, parseInt(parts[0], 10) || 1)
        const end = Math.min(bodyLines.length, parseInt(parts[1], 10) || bodyLines.length)
        bodyContent = bodyLines.slice(start - 1, end).join('\n')
      }
      return { meta: doc.frontmatter, content: bodyContent, links: doc.links }
    }

    // Default: return raw markdown
    const raw = this.storage.readRaw(resolvedKb, targetPath)
    if (lines) {
      const allLines = raw.split('\n')
      const parts = lines.split('-')
      const start = Math.max(1, parseInt(parts[0], 10) || 1)
      const end = Math.min(allLines.length, parseInt(parts[1], 10) || allLines.length)
      return allLines.slice(start - 1, end).join('\n')
    }
    return raw
  }

  // ─── Documents CRUD ───────────────────────────────────────────────────────

  @Post('docs')
  @SetStatus(201)
  async addDoc(@Body() body: { title: string; category: string; tags?: string[]; content: string; kb?: string }) {
    const kbName = this.config.resolveKb(body.kb)
    const id = slugify(body.title)
    const filename = `${id}.md`

    if (this.storage.docExists(kbName, filename)) {
      return { error: `Document "${filename}" already exists in KB "${kbName}".` }
    }

    const frontmatter: DocFrontmatter = {
      id,
      title: body.title,
      category: body.category,
      tags: body.tags || [],
      created: today(),
      updated: today(),
    }

    this.storage.writeDoc(kbName, filename, frontmatter, body.content || '')
    await this.workflow.indexAndEmbed(kbName, id, frontmatter, body.content || '', filename)

    return { id, filename }
  }

  @Put('docs/:id')
  async updateDoc(@Param('id') id: string, @Body() body: { title?: string; category?: string; tags?: string[]; content?: string; append?: string; kb?: string }) {
    const kbName = this.config.resolveKb(body.kb)
    const filename = toFilename(id)
    const docId = toDocId(filename)

    if (!this.storage.docExists(kbName, filename)) {
      return { error: `Document "${filename}" not found in KB "${kbName}".` }
    }

    const doc = this.storage.readDoc(kbName, filename)

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

    this.storage.writeDoc(kbName, filename, frontmatter, docBody)
    await this.workflow.indexAndEmbed(kbName, docId, frontmatter, docBody, filename)

    return { id: docId, filename }
  }

  @Delete('docs/:id')
  async deleteDoc(@Param('id') id: string, @Query('kb') kb: string) {
    const kbName = this.config.resolveKb(kb)
    const filename = toFilename(id)
    const docId = toDocId(filename)

    if (!this.storage.docExists(kbName, filename)) {
      return { error: `Document "${filename}" not found in KB "${kbName}".` }
    }

    const backlinks = await this.index.getLinksTo(kbName, docId)
    const warnings: string[] = []
    if (backlinks.length > 0) {
      const sources = backlinks.map((l) => `${l.fromId}.md`)
      warnings.push(`${backlinks.length} document(s) have broken links to ${filename}: ${sources.join(', ')}`)
    }

    this.storage.deleteDoc(kbName, filename)
    await this.workflow.removeFromIndex(kbName, docId)

    return { deleted: filename, warnings }
  }

  @Get('docs/:id/related')
  async related(@Param('id') id: string, @Query('kb') kb: string, @Query('limit') limit: string) {
    const resolvedKb = this.config.resolveKb(kb)
    const parsedLimit = limit ? parseInt(limit, 10) : 10
    const filename = toFilename(id)
    const docId = toDocId(filename)

    if (!this.storage.docExists(resolvedKb, filename)) {
      return { error: `Document "${filename}" not found in KB "${resolvedKb}".` }
    }

    const scored = await this.workflow.findRelated(resolvedKb, docId, filename, parsedLimit)
    return this.searchService.buildResults(resolvedKb, scored)
  }

  @Post('docs/:id/rename')
  async renameDoc(@Param('id') id: string, @Body() body: { newId: string; kb?: string }) {
    const kbName = this.config.resolveKb(body.kb)
    const oldFilename = toFilename(id)
    const newId = body.newId
    const newFilename = toFilename(newId)

    if (!this.storage.docExists(kbName, oldFilename)) {
      return { error: `Document "${oldFilename}" not found in KB "${kbName}".` }
    }

    if (this.storage.docExists(kbName, newFilename)) {
      return { error: `Document "${newFilename}" already exists in KB "${kbName}".` }
    }

    const doc = this.storage.readDoc(kbName, oldFilename)
    const frontmatter = { ...doc.frontmatter, id: newId, updated: today() }

    this.storage.writeDoc(kbName, newFilename, frontmatter, doc.body)
    this.storage.deleteDoc(kbName, oldFilename)

    const linksUpdated = await this.linker.updateLinksAcrossKb(kbName, oldFilename, newFilename)

    await this.workflow.removeFromIndex(kbName, toDocId(oldFilename))
    await this.workflow.indexAndEmbed(kbName, newId, frontmatter, doc.body, newFilename)

    return { oldId: id, newId, linksUpdated }
  }

  @Get('docs')
  async listDocs(@Query('kb') kb: string, @Query('category') category: string, @Query('tag') tag: string) {
    const kbName = this.config.resolveKb(kb)
    return this.index.listDocs(kbName, { category, tag })
  }

  // ─── Categories ───────────────────────────────────────────────────────────

  @Get('categories')
  async categories(@Query('kb') kb: string) {
    const kbName = this.config.resolveKb(kb)
    const docs = await this.index.listDocs(kbName)
    return [...new Set(docs.map((d) => d.category).filter(Boolean))].sort()
  }

  // ─── Knowledge Bases ──────────────────────────────────────────────────────

  @Get('kb')
  listKbs() {
    return this.kbMgmt.list()
  }

  @Post('kb')
  @SetStatus(201)
  createKb(@Body() body: { name: string }) {
    return this.kbMgmt.create(body.name)
  }

  @Delete('kb/:name')
  deleteKb(@Param('name') name: string) {
    return this.kbMgmt.delete(name)
  }

  // ─── Lint ─────────────────────────────────────────────────────────────────

  @Get('lint')
  async lint(@Query('kb') kb: string) {
    const kbName = this.config.resolveKb(kb)
    return this.workflow.lint(kbName)
  }

  @Post('lint/fix')
  async lintFix(@Query('kb') kb: string) {
    const kbName = this.config.resolveKb(kb)
    const issues = await this.workflow.lint(kbName)
    const fixed = await this.workflow.lintFix(kbName, issues)
    return { fixed }
  }

  // ─── Reindex ──────────────────────────────────────────────────────────────

  @Post('reindex')
  async reindex(@Query('kb') kb: string) {
    const kbName = this.config.resolveKb(kb)
    return this.workflow.reindex(kbName)
  }

  // ─── Table of Contents ────────────────────────────────────────────────────

  @Get('toc')
  async toc(@Query('kb') kb: string) {
    const kbName = this.config.resolveKb(kb)
    const docs = await this.index.listDocs(kbName)

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
  log(@Query('kb') kb: string, @Query('limit') limit: string) {
    const kbName = this.config.resolveKb(kb)
    const parsedLimit = limit ? parseInt(limit, 10) : 20
    return services.activityLog.recent(kbName, parsedLimit)
  }

  // ─── KB Use ────────────────────────────────────────────────────────────────

  @Put('kb/use/:name')
  kbUse(@Param('name') name: string) {
    if (!this.kbMgmt.exists(name)) {
      return { error: `Knowledge base "${name}" does not exist.` }
    }
    this.config.set('defaultKb', name)
    return { defaultKb: name }
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
  schemaRead(@Query('kb') kb: string) {
    const kbName = this.config.resolveKb(kb)
    const content = services.schema.read(kbName)
    if (!content) return { error: 'No schema found. Call POST /api/schema to generate.' }
    return content
  }

  @Post('schema')
  async schemaUpdate(@Query('kb') kb: string) {
    const kbName = this.config.resolveKb(kb)
    await services.schema.update(kbName)
    return { updated: true, kb: kbName }
  }
}
