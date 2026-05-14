import { Controller, Param } from 'moost'
import { Get, Post, Put, Delete, Body, Query, SetStatus, HttpError } from '@moostjs/event-http'
import { services } from '../services/container.js'
import { parseLineRange } from '../utils/slug.js'
import { readContent } from '../utils/content.js'
import { LocalWikiOps, DocNotFoundError, InvalidDocInputError, composeDocInput, type DocInput } from '../services/wiki-ops.js'

/**
 * The wire shape POST/PUT /api/docs accepts. Both `body` (canonical) and
 * legacy `content`/`text` aliases are accepted. `apiBodyToInput` funnels
 * the wire payload through the SAME `composeDocInput` used by the CLI, so
 * suppression / frontmatter handling is identical regardless of caller.
 */
interface ApiDocBody {
  title?: string
  category?: string
  tags?: string[]
  body?: string
  content?: string
  text?: string
  appendBody?: string
  append?: string
  raw?: string
  dryRun?: boolean
  wiki?: string
  importantSections?: string[]
  suppressMergeWarn?: string[]
  suppressLint?: string[]
}

function apiBodyToInput(body: ApiDocBody): DocInput {
  // `raw` lets HTTP callers send a full markdown blob (frontmatter + body)
  // and have the server parse it just like `kb add --file`.
  const rawFileContent = body.raw
  const rawBody = rawFileContent === undefined
    ? (body.body ?? body.content ?? body.text)
    : undefined
  return composeDocInput({
    parser: services.parser,
    rawFileContent,
    rawBody,
    appendBody: body.appendBody ?? body.append,
    overrides: {
      title: body.title,
      category: body.category,
      tags: body.tags,
      importantSections: body.importantSections,
      suppressMergeWarn: body.suppressMergeWarn,
      suppressLint: body.suppressLint,
    },
  })
}

function httpErrorFor(err: any): HttpError {
  // DocNotFoundError → 404 with suggestions in the body so clients can
  // surface them without re-running `kb resolve`. `HttpError.body` overwrites
  // `error` with the HTTP status name; our text lives in `message`.
  if (err instanceof DocNotFoundError) {
    return new HttpError(404, {
      message: err.message,
      kind: 'doc-not-found',
      id: err.id,
      filename: err.filename,
      suggestions: err.suggestions,
    } as never)
  }
  if (err instanceof InvalidDocInputError) {
    return new HttpError(400, { message: err.message, kind: 'invalid-doc-input' } as never)
  }
  return new HttpError(500, err?.message ?? 'Internal error')
}

function sliceLines(content: string, lines?: string): string {
  if (!lines) return content
  const { start, end } = parseLineRange(lines)
  return content.split('\n').slice(start - 1, end).join('\n')
}

@Controller('api')
export class ApiController {
  private get config() { return services.config }
  private get storage() { return services.storage }
  private get index() { return services.index }
  private get searchService() { return services.search }
  private get workflow() { return services.docWorkflow }
  private get wikiMgmt() { return services.wikiManagement }
  private get activityLog() { return services.activityLog }
  private get schema() { return services.schema }

  // ─── Discovery ────────────────────────────────────────────────────────────

  @Get('')
  root() {
    return {
      name: 'kb',
      version: __VERSION__,
      endpoints: [
        'GET  /api/health',
        'GET  /api/search?q=&wiki=&limit=&mode=fts|vec|hybrid',
        'GET  /api/read/:id?wiki=&lines=&meta=true&links=true&format=json',
        'GET  /api/read-slice/:id?wiki=&from=&to=',
        'GET  /api/resolve/:input?wiki=  → { id, filename, exists, title?, category?, suggestions[] }',
        'POST /api/docs  { title, category, tags[], body|content|text, dryRun?, wiki? } → { id, filename, issues[] }',
        'PUT  /api/docs/:id  { title?, category?, tags?, body?, append?, dryRun?, wiki? } → { id, filename, issues[] }',
        'DELETE /api/docs/:id?wiki=',
        'GET  /api/docs?wiki=&category=&tag=  (alias: /api/list)',
        'GET  /api/related/:id?wiki=&limit=  (alias: /api/docs/:id/related)',
        'POST /api/docs/:id/rename  { to|newId, wiki? }',
        'GET  /api/categories?wiki=',
        'GET  /api/lint?wiki=',
        'POST /api/lint/fix?wiki=',
        'POST /api/reindex?wiki=',
        'POST /api/reindex/:id?wiki=',
        'GET  /api/toc?wiki=',
        'GET  /api/schema?wiki=',
        'POST /api/schema?wiki=',
        'GET  /api/log?wiki=&limit=',
        'GET  /api/wiki  (alias: /api/wikis)',
        'GET  /api/wiki/:name',
        'POST /api/wiki  { name }',
        'PUT  /api/wiki/use/:name',
        'DELETE /api/wiki/:name',
        'GET  /api/skill?workflow=',
      ],
    }
  }

  @Get('health')
  health() {
    return { status: 'ok' }
  }

  // ─── Search ───────────────────────────────────────────────────────────────

  @Get('search')
  async search(@Query('q') q: string, @Query('limit') limit: string, @Query('mode') mode: string, @Query('wiki') wiki: string) {
    const resolvedWiki = this.config.resolveWikiName(wiki)
    const parsedLimit = limit ? parseInt(limit, 10) : 10
    if (!q) return { error: 'Query parameter "q" is required' }
    const searchMode = (mode === 'fts' || mode === 'vec') ? mode : 'hybrid' as const
    return this.searchService.search(resolvedWiki, q, parsedLimit, searchMode)
  }

  // ─── Read ─────────────────────────────────────────────────────────────────

  @Get('read/:filename')
  async read(@Param('filename') filename: string, @Query('wiki') wiki: string, @Query('lines') lines: string, @Query('format') format: string, @Query('meta') meta: string, @Query('links') links: string) {
    const wikiName = this.config.resolveWikiName(wiki)
    try {
      const doc = await this.localOps(wikiName).readDoc(filename)
      if (meta === 'true' || meta === '1') return doc.frontmatter
      if (links === 'true' || links === '1') return doc.links
      if (format === 'json') {
        return { meta: doc.frontmatter, content: sliceLines(doc.body, lines), links: doc.links }
      }
      return sliceLines(await this.localOps(wikiName).readRaw(filename), lines)
    } catch (err: any) {
      throw httpErrorFor(err)
    }
  }

  @Get('resolve/:input')
  async resolve(@Param('input') input: string, @Query('wiki') wiki: string) {
    const wikiName = this.config.resolveWikiName(wiki)
    return this.localOps(wikiName).resolve(input)
  }

  @Get('read-slice/:filename')
  async readSlice(@Param('filename') filename: string, @Query('wiki') wiki: string, @Query('from') from: string, @Query('to') to: string) {
    const wikiName = this.config.resolveWikiName(wiki)
    try {
      return await this.localOps(wikiName).readSlice(filename, parseInt(from, 10) || 1, parseInt(to, 10) || Infinity)
    } catch (err: any) {
      throw httpErrorFor(err)
    }
  }

  // ─── Documents CRUD ───────────────────────────────────────────────────────

  @Post('docs')
  @SetStatus(201)
  async addDoc(@Body() body: ApiDocBody) {
    const wikiName = this.config.resolveWikiName(body.wiki)
    try {
      return await this.localOps(wikiName).addDoc(apiBodyToInput(body), { dryRun: body.dryRun })
    } catch (err: any) {
      throw httpErrorFor(err)
    }
  }

  @Put('docs/:id')
  async updateDoc(@Param('id') id: string, @Body() body: ApiDocBody) {
    const wikiName = this.config.resolveWikiName(body.wiki)
    try {
      return await this.localOps(wikiName).updateDoc(id, apiBodyToInput(body), { dryRun: body.dryRun })
    } catch (err: any) {
      throw httpErrorFor(err)
    }
  }

  private localOps(wikiName: string) {
    return new LocalWikiOps(wikiName, {
      storage: services.storage,
      search: services.search,
      index: services.index,
      workflow: services.docWorkflow,
      schema: services.schema,
      activityLog: services.activityLog,
      parser: services.parser,
    })
  }

  @Delete('docs/:id')
  async deleteDoc(@Param('id') id: string, @Query('wiki') wiki: string) {
    const wikiName = this.config.resolveWikiName(wiki)
    try {
      return await this.localOps(wikiName).deleteDoc(id)
    } catch (err: any) {
      throw httpErrorFor(err)
    }
  }

  @Get('docs/:id/related')
  @Get('related/:id')
  async related(@Param('id') id: string, @Query('wiki') wiki: string, @Query('limit') limit: string) {
    const wikiName = this.config.resolveWikiName(wiki)
    const parsedLimit = limit ? parseInt(limit, 10) : 10
    try {
      return await this.localOps(wikiName).related(id, parsedLimit)
    } catch (err: any) {
      throw httpErrorFor(err)
    }
  }

  @Post('docs/:id/rename')
  async renameDoc(@Param('id') id: string, @Body() body: { newId?: string; to?: string; name?: string; wiki?: string }) {
    const wikiName = this.config.resolveWikiName(body.wiki)
    const rawNewId = body.newId || body.to || body.name
    if (!rawNewId) {
      throw new HttpError(400, 'Missing "newId" (or "to") in request body.')
    }
    try {
      return await this.localOps(wikiName).rename(id, rawNewId)
    } catch (err: any) {
      throw httpErrorFor(err)
    }
  }

  @Get('docs')
  @Get('list')
  async listDocs(@Query('wiki') wiki: string, @Query('category') category: string, @Query('tag') tag: string) {
    const wikiName = this.config.resolveWikiName(wiki)
    return this.index.listDocs(wikiName, { category, tag })
  }

  // ─── Categories ───────────────────────────────────────────────────────────

  @Get('categories')
  async categories(@Query('wiki') wiki: string) {
    const wikiName = this.config.resolveWikiName(wiki)
    const docs = await this.index.listDocs(wikiName)
    return [...new Set(docs.map((d) => d.category).filter(Boolean))].sort()
  }

  // ─── Wikis ────────────────────────────────────────────────────────────────

  @Get('wiki')
  @Get('wikis')
  listWikis() {
    return this.wikiMgmt.list()
  }

  @Get('wiki/:name')
  async wikiInfo(@Param('name') name: string) {
    if (!this.wikiMgmt.exists(name)) {
      throw new HttpError(404, `Wiki "${name}" does not exist.`)
    }
    return this.localOps(name).info()
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
    const wikiName = this.config.resolveWikiName(wiki)
    return this.workflow.lint(wikiName)
  }

  @Post('lint/fix')
  async lintFix(@Query('wiki') wiki: string) {
    const wikiName = this.config.resolveWikiName(wiki)
    const issues = await this.workflow.lint(wikiName)
    const repairs = await this.workflow.lintFix(wikiName, issues)
    return { fixed: repairs.length, repairs }
  }

  // ─── Reindex ──────────────────────────────────────────────────────────────

  @Post('reindex')
  async reindex(@Query('wiki') wiki: string) {
    const wikiName = this.config.resolveWikiName(wiki)
    return this.workflow.reindex(wikiName)
  }

  @Post('reindex/:id')
  async reindexDoc(@Param('id') id: string, @Query('wiki') wiki: string) {
    const wikiName = this.config.resolveWikiName(wiki)
    try {
      return await this.localOps(wikiName).reindexDoc(id)
    } catch (err: any) {
      throw httpErrorFor(err)
    }
  }

  // ─── Table of Contents ────────────────────────────────────────────────────

  @Get('toc')
  async toc(@Query('wiki') wiki: string) {
    const wikiName = this.config.resolveWikiName(wiki)
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
    const wikiName = this.config.resolveWikiName(wiki)
    const parsedLimit = limit ? parseInt(limit, 10) : 20
    return this.activityLog.recent(wikiName, parsedLimit)
  }

  @Post('log')
  logAdd(@Body() body: { op?: string; doc?: string; details?: string; wiki?: string }) {
    const wikiName = this.config.resolveWikiName(body.wiki)
    this.activityLog.log(wikiName, body.op || 'note', body.doc, body.details)
    return { logged: true, op: body.op || 'note', doc: body.doc, details: body.details }
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
    const filename = workflow ? `skill-${workflow}.md` : 'skill.md'
    const content = readContent(filename)
    if (content.startsWith('Error:')) {
      return { error: `Unknown workflow "${workflow}". Available: ingest, search, update, lint` }
    }
    return content
  }

  // ─── Schema ────────────────────────────────────────────────────────────────

  @Get('schema')
  schemaRead(@Query('wiki') wiki: string) {
    const wikiName = this.config.resolveWikiName(wiki)
    const content = this.schema.read(wikiName)
    if (!content) return { error: 'No schema found. Call POST /api/schema to generate.' }
    return content
  }

  @Post('schema')
  async schemaUpdate(@Query('wiki') wiki: string) {
    const wikiName = this.config.resolveWikiName(wiki)
    await this.schema.update(wikiName)
    return { updated: true, wiki: wikiName }
  }
}
