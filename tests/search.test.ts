import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-search-'))

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: () => tmpDir }
})

const { ConfigService } = await import('../src/services/config.service.js')
const { IndexService } = await import('../src/services/index.service.js')
const { EmbeddingService } = await import('../src/services/embedding.service.js')
const { StorageService } = await import('../src/services/storage.service.js')
const { ParserService } = await import('../src/services/parser.service.js')
const { LinkerService } = await import('../src/services/linker.service.js')
const { ChunkerService } = await import('../src/services/chunker.service.js')
const { ChunkFtsService } = await import('../src/services/chunk-fts.service.js')
const { DocWorkflowService } = await import('../src/services/doc-workflow.service.js')
const { SearchService } = await import('../src/services/search.service.js')

const kbDir = path.join(tmpDir, '.kb')

function freshKbDir() {
  if (fs.existsSync(kbDir)) fs.rmSync(kbDir, { recursive: true, force: true })
  fs.mkdirSync(kbDir, { recursive: true })
}

// Token-bag vector: a 768-dim embedding where each token sets a deterministic
// dimension to 1. Query vectors built the same way share dimensions with docs
// that contain the same tokens — gives semanticSearchChunks predictable ranking.
function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
}

function tokenVec(text: string): Float32Array {
  const v = new Float32Array(768)
  for (const tok of tokenize(text)) {
    let h = 0
    for (let i = 0; i < tok.length; i++) h = (h * 31 + tok.charCodeAt(i)) | 0
    v[Math.abs(h) % 768] = 1
  }
  let norm = 0
  for (let i = 0; i < 768; i++) norm += v[i] * v[i]
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < 768; i++) v[i] /= norm
  return v
}

function buildServices() {
  const config = new ConfigService()
  const parser = new ParserService()
  const storage = new StorageService(config, parser)
  const index = new IndexService(config)
  const embedding = new EmbeddingService(config)
  const linker = new LinkerService(storage, parser, index)
  const chunker = new ChunkerService()
  const chunkFts = new ChunkFtsService(config)

  embedding.embedBatch = async (texts: string[]) => texts.map((t) => tokenVec(t))
  embedding.embed = async (t: string) => tokenVec(t)
  embedding.init = async () => undefined

  const docWorkflow = new DocWorkflowService(parser, index, linker, embedding, storage, chunker, chunkFts)
  const search = new SearchService(embedding, chunkFts, index, storage)
  return { config, parser, storage, index, embedding, chunker, chunkFts, docWorkflow, search }
}

function writeMarkdown(wiki: string, id: string, body: string, category = 'misc') {
  const docsDir = path.join(kbDir, wiki, 'docs')
  fs.mkdirSync(docsDir, { recursive: true })
  const fm = [
    '---',
    `id: ${id}`,
    `title: ${id}`,
    `category: ${category}`,
    'tags: []',
    'created: 2026-01-01',
    'updated: 2026-01-01',
    '---',
    '',
    body,
    '',
  ].join('\n')
  fs.writeFileSync(path.join(docsDir, `${id}.md`), fm, 'utf-8')
}

async function indexAll(services: ReturnType<typeof buildServices>, wiki: string) {
  for (const file of services.storage.listFiles(wiki)) {
    const doc = services.storage.readDoc(wiki, file)
    const id = file.replace(/\.md$/, '')
    await services.docWorkflow.indexAndEmbed(wiki, id, doc.frontmatter)
  }
}

describe('SearchService', () => {
  beforeEach(() => {
    freshKbDir()
  })

  afterEach(() => {
    if (fs.existsSync(kbDir)) fs.rmSync(kbDir, { recursive: true, force: true })
  })

  it('vec mode returns matching chunk with line range that slices to relevant content', async () => {
    writeMarkdown('w', 'alpha', '# Alpha\n\n## Section A\n\napple tree grows tall\n\n## Section B\n\nbanana yellow ripe')
    writeMarkdown('w', 'beta', '# Beta\n\ncherry pie tastes great')
    writeMarkdown('w', 'gamma', '# Gamma\n\ndurian fruit smells')

    const services = buildServices()
    await indexAll(services, 'w')

    const results = await services.search.search('w', 'banana', 10, 'vec')
    expect(results.length).toBeGreaterThan(0)
    const bananaHit = results.find(r => r.filename === 'alpha.md')
    expect(bananaHit).toBeDefined()

    const slice = services.storage.readSlice('w', bananaHit!.filename, bananaHit!.lines[0], bananaHit!.lines[1]).content
    expect(slice.toLowerCase()).toContain('banana')
  })

  it('vec mode line range round-trip slices content with the query word', async () => {
    writeMarkdown('w', 'doc', '# Doc\n\n## Intro\n\nbody intro\n\n## Special\n\nthis line has the keyword zephyr in it\n\n## Outro\n\nfinal thoughts')
    const services = buildServices()
    await indexAll(services, 'w')

    const results = await services.search.search('w', 'zephyr', 10, 'vec')
    expect(results.length).toBeGreaterThan(0)
    const top = results[0]
    const sliced = services.storage.readSlice('w', top.filename, top.lines[0], top.lines[1]).content
    expect(sliced.toLowerCase()).toContain('zephyr')
  })

  it('per-doc cap = 2: a single doc cannot dominate results', async () => {
    const sections = Array.from({ length: 6 }, (_, i) => `## Section ${i}\n\nrocket section ${i} body about rockets`).join('\n\n')
    writeMarkdown('w', 'rockets', `# Rockets\n\n${sections}`)
    writeMarkdown('w', 'other', '# Other\n\nrocket appears here too')

    const services = buildServices()
    await indexAll(services, 'w')

    const results = await services.search.search('w', 'rocket', 10, 'vec')
    const fromRockets = results.filter(r => r.filename === 'rockets.md')
    expect(fromRockets.length).toBeLessThanOrEqual(2)
  })

  it('no results: empty kb returns []', async () => {
    // No docs indexed → both vec and fts searches must return [] regardless of query.
    const services = buildServices()
    fs.mkdirSync(path.join(kbDir, 'w', 'docs'), { recursive: true })
    services.chunkFts.ensureTables('w')
    await services.index.getSpace('w')

    expect(await services.search.search('w', 'anything', 10, 'vec')).toEqual([])
    expect(await services.search.search('w', 'anything', 10, 'fts')).toEqual([])
    expect(await services.search.search('w', 'anything', 10, 'hybrid')).toEqual([])
  })

  it('hybrid mode returns at least as many results as vec-only', async () => {
    writeMarkdown('w', 'alpha', '# Alpha\n\n## Section A\n\nbanana yellow ripe\n\n## Section B\n\norange citrus')
    writeMarkdown('w', 'beta', '# Beta\n\ncherry pie')

    const services = buildServices()
    await indexAll(services, 'w')

    const vecResults = await services.search.search('w', 'banana', 10, 'vec')
    const hybridResults = await services.search.search('w', 'banana', 10, 'hybrid')

    expect(hybridResults.length).toBeGreaterThanOrEqual(vecResults.length)
  })

  // chunkFts.search joins the chunks table on rowid to return real chunk ids,
  // so listChunksByIds resolves and fts-only search returns the matching chunk.
  it('fts mode returns matching chunk for literal word in body', async () => {
    writeMarkdown('w', 'alpha', '# Alpha\n\n## Section A\n\nunique-needle-token in this body')
    writeMarkdown('w', 'beta', '# Beta\n\nirrelevant body')

    const services = buildServices()
    await indexAll(services, 'w')

    const results = await services.search.search('w', 'unique-needle-token', 10, 'fts')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].filename).toBe('alpha.md')
  })
})
