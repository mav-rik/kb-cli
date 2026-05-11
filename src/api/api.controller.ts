import * as fs from 'node:fs'
import * as path from 'node:path'
import { Controller, Param } from 'moost'
import { Get, Post, Put, Delete, Body, Query, SetStatus } from '@moostjs/event-http'
import { services } from '../services/container.js'
import { slugify, toFilename, toDocId, today } from '../utils/slug.js'
import { contentHash } from '../utils/hash.js'
import { DocFrontmatter } from '../services/parser.service.js'

@Controller('api')
export class ApiController {
  private get config() { return services.config }
  private get storage() { return services.storage }
  private get parser() { return services.parser }
  private get index() { return services.index }
  private get linker() { return services.linker }
  private get embedding() { return services.embedding }
  private get vector() { return services.vector }
  private get fts() { return services.fts }
  private get searchService() { return services.search }

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
  async read(@Param('filename') filename: string, @Query('kb') kb: string, @Query('lines') lines: string) {
    const resolvedKb = this.config.resolveKb(kb)
    const targetPath = toFilename(filename)

    if (!this.storage.docExists(resolvedKb, targetPath)) {
      return { error: `Document "${targetPath}" not found in KB "${resolvedKb}".` }
    }

    const doc = this.storage.readDoc(resolvedKb, targetPath)

    let bodyContent = doc.body
    if (lines) {
      const bodyLines = doc.body.split('\n')
      const parts = lines.split('-')
      const start = Math.max(1, parseInt(parts[0], 10) || 1)
      const end = Math.min(bodyLines.length, parseInt(parts[1], 10) || bodyLines.length)
      bodyContent = bodyLines.slice(start - 1, end).join('\n')
    }

    return {
      meta: doc.frontmatter,
      content: bodyContent,
      links: doc.links,
    }
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
    await this.indexAndEmbed(kbName, id, frontmatter, body.content || '', filename)

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
    await this.indexAndEmbed(kbName, docId, frontmatter, docBody, filename)

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
    await this.index.deleteDoc(kbName, docId)
    this.vector.ensureTables(kbName)
    this.vector.deleteVec(kbName, docId)
    this.fts.delete(kbName, docId)

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

    const parsed = this.storage.readDoc(resolvedKb, filename)
    const queryText = `${parsed.frontmatter.title} ${parsed.body}`.slice(0, 500)
    const queryVec = await this.embedding.embed(queryText)

    const vecResults = this.vector.searchVec(resolvedKb, queryVec, parsedLimit + 1)
    const filtered = vecResults.filter((r) => r.id !== docId).slice(0, parsedLimit)

    const scored: [string, number][] = filtered.map(({ id: relId, distance }) => [relId, 1 / (1 + distance)])
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

    await this.index.deleteDoc(kbName, toDocId(oldFilename))
    this.fts.delete(kbName, toDocId(oldFilename))
    await this.indexAndEmbed(kbName, newId, frontmatter, doc.body, newFilename)

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
    const dataDir = this.config.getDataDir()
    if (!fs.existsSync(dataDir)) return []

    const entries = fs.readdirSync(dataDir, { withFileTypes: true })
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && fs.existsSync(path.join(dataDir, e.name, 'docs')))
      .map((e) => e.name)
  }

  @Post('kb')
  @SetStatus(201)
  createKb(@Body() body: { name: string }) {
    const name = body.name
    if (!name || !/^[a-z0-9][a-z0-9_-]*$/.test(name)) {
      return { error: 'KB name must contain only lowercase letters, numbers, dashes, and underscores.' }
    }

    const dataDir = this.config.getDataDir()
    const kbDir = path.join(dataDir, name, 'docs')

    if (fs.existsSync(kbDir)) {
      return { error: `Knowledge base "${name}" already exists.` }
    }

    fs.mkdirSync(kbDir, { recursive: true })
    return { name }
  }

  @Delete('kb/:name')
  deleteKb(@Param('name') name: string) {
    const dataDir = this.config.getDataDir()
    const kbDir = path.join(dataDir, name)

    if (!fs.existsSync(path.join(kbDir, 'docs'))) {
      return { error: `Knowledge base "${name}" does not exist.` }
    }

    fs.rmSync(kbDir, { recursive: true, force: true })
    return { deleted: name }
  }

  // ─── Lint ─────────────────────────────────────────────────────────────────

  @Get('lint')
  async lint(@Query('kb') kb: string) {
    const kbName = this.config.resolveKb(kb)
    const issues: { type: string; severity: string; file: string; details: string }[] = []

    const brokenLinks = this.linker.findBrokenLinks(kbName)
    for (const bl of brokenLinks) {
      issues.push({
        type: 'broken',
        severity: 'error',
        file: bl.fromFile,
        details: `Link to ./${bl.targetFile} not found`,
      })
    }

    const orphans = await this.linker.findOrphans(kbName)
    for (const orphan of orphans) {
      issues.push({
        type: 'orphan',
        severity: 'warning',
        file: orphan,
        details: 'No incoming links',
      })
    }

    const files = this.storage.listFiles(kbName)
    for (const file of files) {
      const raw = this.storage.readRaw(kbName, file)
      const parsed = this.parser.parse(raw)

      const missing: string[] = []
      if (!parsed.frontmatter.id) missing.push('id')
      if (!parsed.frontmatter.title) missing.push('title')
      if (!parsed.frontmatter.category) missing.push('category')
      if (missing.length > 0) {
        issues.push({
          type: 'missing',
          severity: 'error',
          file,
          details: `Missing frontmatter: ${missing.join(', ')}`,
        })
      }

      const fileHash = contentHash(parsed.body)
      const docId = toDocId(file)
      const indexDoc = await this.index.getDoc(kbName, docId)
      if (indexDoc && indexDoc.contentHash !== fileHash) {
        issues.push({
          type: 'drift',
          severity: 'warning',
          file,
          details: 'Index out of sync with file content',
        })
      }
    }

    return issues
  }

  @Post('lint/fix')
  async lintFix(@Query('kb') kb: string) {
    const kbName = this.config.resolveKb(kb)
    let fixedCount = 0

    const brokenLinks = this.linker.findBrokenLinks(kbName)
    for (const bl of brokenLinks) {
      const raw = this.storage.readRaw(kbName, bl.fromFile)
      const target = bl.targetFile
      const linkPattern = new RegExp(
        `\\[([^\\]]+)\\]\\(\\.\\/` + target.replace(/\./g, '\\.') + `\\)`,
        'g',
      )
      const fixed = raw.replace(linkPattern, '$1')
      if (fixed !== raw) {
        const parsed = this.parser.parse(fixed)
        this.storage.writeDoc(kbName, bl.fromFile, parsed.frontmatter, parsed.body)
        fixedCount++
      }
    }

    const files = this.storage.listFiles(kbName)
    for (const file of files) {
      const doc = this.storage.readDoc(kbName, file)
      const docId = toDocId(file)
      const fileHash = contentHash(doc.body)
      const indexDoc = await this.index.getDoc(kbName, docId)
      if (indexDoc && indexDoc.contentHash !== fileHash) {
        await this.index.upsertDoc(kbName, {
          id: docId,
          title: doc.frontmatter.title,
          category: doc.frontmatter.category,
          tags: doc.frontmatter.tags,
          filePath: file,
          contentHash: fileHash,
        })
        fixedCount++
      }
    }

    return { fixed: fixedCount }
  }

  // ─── Reindex ──────────────────────────────────────────────────────────────

  @Post('reindex')
  async reindex(@Query('kb') kb: string) {
    const kbName = this.config.resolveKb(kb)
    const startTime = Date.now()

    await this.index.dropAll(kbName)
    this.vector.ensureTables(kbName)
    this.vector.dropAll(kbName)
    this.fts.dropAll(kbName)

    const files = this.storage.listFiles(kbName)

    for (const file of files) {
      const doc = this.storage.readDoc(kbName, file)
      const docId = toDocId(file)
      const hash = contentHash(doc.body)

      await this.index.upsertDoc(kbName, {
        id: docId,
        title: doc.frontmatter.title,
        category: doc.frontmatter.category,
        tags: doc.frontmatter.tags,
        filePath: file,
        contentHash: hash,
      })

      if (doc.links.length > 0) {
        await this.index.upsertLinks(
          kbName,
          docId,
          doc.links.map((l) => ({ toId: toDocId(l.target), linkText: l.text })),
        )
      }

      this.fts.upsert(kbName, docId, doc.frontmatter.title, doc.frontmatter.tags || [], doc.body || '')

      const embedding = await this.embedding.embed(doc.body || doc.frontmatter.title)
      this.vector.upsertVec(kbName, docId, embedding)
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    return { count: files.length, elapsed: `${elapsed}s` }
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
}
