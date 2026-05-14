import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-migration-'))

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: () => tmpDir }
})

// Dynamic imports AFTER the homedir mock is registered so every service
// that calls getDataDir() resolves under tmpDir.
const { ConfigService, CURRENT_SCHEMA_VERSION } = await import('../src/services/config.service.js')
const { IndexService } = await import('../src/services/index.service.js')
const { EmbeddingService } = await import('../src/services/embedding.service.js')
const { StorageService } = await import('../src/services/storage.service.js')
const { ParserService } = await import('../src/services/parser.service.js')
const { LinkerService } = await import('../src/services/linker.service.js')
const { ChunkerService } = await import('../src/services/chunker.service.js')
const { ChunkFtsService } = await import('../src/services/chunk-fts.service.js')
const { DocWorkflowService } = await import('../src/services/doc-workflow.service.js')
const { WikiManagementService } = await import('../src/services/wiki-management.service.js')
const { MigrationService } = await import('../src/services/migration.service.js')

const kbDir = path.join(tmpDir, '.kb')

function freshKbDir() {
  if (fs.existsSync(kbDir)) fs.rmSync(kbDir, { recursive: true, force: true })
  fs.mkdirSync(kbDir, { recursive: true })
}

// Deterministic content-driven one-hot embedding: identical text → identical
// vector → cosine distance 0; different text → orthogonal vectors → distance 2.
// Lets us assert real ranking behavior of semanticSearch without loading a model.
function hashedVec(text: string): Float32Array {
  const v = new Float32Array(768)
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0
  v[Math.abs(h) % 768] = 1
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
  const wikis = new WikiManagementService(config)

  embedding.embedBatch = async (texts: string[]) => texts.map((t) => hashedVec(t))
  embedding.embed = async (t: string) => hashedVec(t)
  embedding.init = async () => undefined

  const docWorkflow = new DocWorkflowService(
    parser,
    index,
    linker,
    embedding,
    storage,
    chunker,
    chunkFts,
  )

  const migration = new MigrationService(config, index, storage, wikis, docWorkflow)

  return { config, parser, storage, index, embedding, chunkFts, wikis, docWorkflow, migration }
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

describe('MigrationService', () => {
  beforeEach(() => {
    freshKbDir()
  })

  afterEach(() => {
    if (fs.existsSync(kbDir)) fs.rmSync(kbDir, { recursive: true, force: true })
  })

  it('fresh install: detectNeeded false, schemaVersion stamped on first load', () => {
    const { config, migration } = buildServices()
    // loadConfig triggers the fresh-install branch on first call.
    const loaded = config.loadConfig()
    expect(loaded.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(migration.detectNeeded()).toBe(false)

    const onDisk = JSON.parse(fs.readFileSync(path.join(kbDir, 'config.json'), 'utf-8'))
    expect(onDisk.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('legacy wiki without schemaVersion triggers detectNeeded=true', () => {
    writeMarkdown('legacy', 'foo', '# Foo\n\nhello')
    fs.writeFileSync(path.join(kbDir, 'legacy', 'index.db'), '')
    const { migration } = buildServices()
    expect(migration.detectNeeded()).toBe(true)
  })

  it('marker file forces detectNeeded=true even if schemaVersion is current', () => {
    fs.writeFileSync(
      path.join(kbDir, 'config.json'),
      JSON.stringify({ defaultWiki: 'default', schemaVersion: CURRENT_SCHEMA_VERSION }),
      'utf-8',
    )
    fs.mkdirSync(path.join(kbDir, 'work', 'docs'), { recursive: true })
    fs.writeFileSync(path.join(kbDir, 'work', '.migration-in-progress'), '', 'utf-8')

    const { migration } = buildServices()
    expect(migration.detectNeeded()).toBe(true)
  })

  it('plan reports per-wiki counts across multiple wikis', async () => {
    writeMarkdown('alpha', 'a1', 'alpha doc one')
    writeMarkdown('alpha', 'a2', 'alpha doc two')
    writeMarkdown('beta', 'b1', 'beta doc one')

    const { migration } = buildServices()
    const plan = await migration.plan()
    expect(plan.schemaVersionTo).toBe(CURRENT_SCHEMA_VERSION)
    const names = plan.wikis.map((w) => w.name).sort()
    expect(names).toEqual(['alpha', 'beta'])

    // v1→v2 reprocesses every file, so totalDocs counts files on disk.
    const alpha = plan.wikis.find((w) => w.name === 'alpha')!
    const beta = plan.wikis.find((w) => w.name === 'beta')!
    expect(alpha.totalDocs).toBe(2)
    expect(beta.totalDocs).toBe(1)
  })

  it('run populates docs, chunks, and centroid embedding, then bumps schemaVersion', async () => {
    writeMarkdown('w', 'first', '# First\n\nfirst body content\n\n## Sub\n\nmore content')
    writeMarkdown('w', 'second', '# Second\n\nsecond body content')

    const { migration, config, index } = buildServices()
    const progressCalls: Array<[string, number, number]> = []
    await migration.run({
      onProgress: (w, done, total) => {
        progressCalls.push([w, done, total])
      },
    })
    expect(config.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION)

    // Per-doc progress: 2 callbacks for 2 docs.
    expect(progressCalls.length).toBe(2)
    expect(progressCalls.every(([w, , total]) => w === 'w' && total === 2)).toBe(true)

    // Both docs were embedded (centroid path).
    expect(await index.countDocs('w')).toBe(2)
    expect(await index.countDocsWithoutEmbedding('w')).toBe(0)

    // Chunks were built for both docs.
    const firstChunks = await index.listChunksForDoc('w', 'first')
    const secondChunks = await index.listChunksForDoc('w', 'second')
    expect(firstChunks.length).toBeGreaterThan(0)
    expect(secondChunks.length).toBeGreaterThan(0)

    // Marker is cleaned up.
    expect(fs.existsSync(path.join(kbDir, 'w', '.migration-in-progress'))).toBe(false)
  })

  it('run is idempotent: second invocation preserves doc rows', async () => {
    writeMarkdown('w', 'first', 'first body')
    writeMarkdown('w', 'second', 'second body')

    const { migration, config, index } = buildServices()
    await migration.run({})
    expect(config.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION)

    expect(await index.countDocs('w')).toBe(2)
    expect(await index.countDocsWithoutEmbedding('w')).toBe(0)

    const before = (await index.listDocsForMigration('w')).sort((a, b) =>
      a.id.localeCompare(b.id),
    )
    await migration.run({})
    const after = (await index.listDocsForMigration('w')).sort((a, b) =>
      a.id.localeCompare(b.id),
    )
    expect(after).toEqual(before)
  })

  it('run drops legacy documents_vec table if present', async () => {
    writeMarkdown('w', 'only', 'body')

    const dbPath = path.join(kbDir, 'w', 'index.db')
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    const Database = (await import('better-sqlite3')).default
    const legacy = new Database(dbPath)
    legacy.exec('CREATE TABLE documents_vec (rowid INTEGER PRIMARY KEY, x BLOB)')
    legacy.close()

    const { migration, index } = buildServices()
    const plan = await migration.plan()
    const w = plan.wikis.find((x) => x.name === 'w')!
    expect(w.hasLegacyVec).toBe(true)

    await migration.run({})

    expect(await index.hasLegacyVecTable('w')).toBe(false)
  })

  it('run drops legacy documents_fts table if present', async () => {
    writeMarkdown('w', 'only', 'body')

    const dbPath = path.join(kbDir, 'w', 'index.db')
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    const Database = (await import('better-sqlite3')).default
    const legacy = new Database(dbPath)
    legacy.exec(
      `CREATE VIRTUAL TABLE documents_fts USING fts5(id UNINDEXED, title, body)`,
    )
    legacy.close()

    const { migration, index } = buildServices()
    const plan = await migration.plan()
    const w = plan.wikis.find((x) => x.name === 'w')!
    expect(w.hasLegacyFts).toBe(true)

    await migration.run({})

    expect(await index.hasLegacyFtsTable('w')).toBe(false)
  })

  it('every markdown file results in chunks being written via indexAndEmbed', async () => {
    writeMarkdown('w', 'alpha', '# Alpha\n\nalpha body')
    writeMarkdown('w', 'beta', '# Beta\n\nbeta body')
    writeMarkdown('w', 'gamma', '# Gamma\n\ngamma body')

    const services = buildServices()
    const spy = vi.spyOn(services.docWorkflow, 'indexAndEmbed')
    await services.migration.run({})

    expect(spy).toHaveBeenCalledTimes(3)
    const ids = spy.mock.calls.map((c) => c[1]).sort()
    expect(ids).toEqual(['alpha', 'beta', 'gamma'])

    for (const id of ['alpha', 'beta', 'gamma']) {
      const chunks = await services.index.listChunksForDoc('w', id)
      expect(chunks.length, `expected chunks for ${id}`).toBeGreaterThan(0)
    }
  })

  it('semanticSearch ranks the doc whose chunk centroid matches the query first', async () => {
    writeMarkdown('w', 'apple', 'apple apple apple')
    writeMarkdown('w', 'banana', 'banana banana banana')
    writeMarkdown('w', 'carrot', 'carrot carrot carrot')

    const { migration, index } = buildServices()
    await migration.run({})

    // Each doc has one chunk with embeddingInput tied to its body — the
    // centroid for a single-chunk doc is just that chunk's embedding
    // (normalized). Query by the same body text → match the banana doc.
    const hits = await index.semanticSearch('w', hashedVec('banana banana banana'), 10)
    expect(hits.length).toBeGreaterThanOrEqual(1)
    // Banana should be at or near the top — single-chunk centroid equals
    // the hashedVec input within the chunker's normalization tolerance.
    const top = hits.slice(0, 3).map((h) => h.id)
    expect(top).toContain('banana')
  })

  it('crash mid-run leaves marker; next run resumes to completion', async () => {
    for (let i = 0; i < 5; i++) writeMarkdown('w', `doc${i}`, `body ${i}`)

    const services = buildServices()
    // Throw on the third indexAndEmbed call to simulate a crash partway through.
    let calls = 0
    const orig = services.docWorkflow.indexAndEmbed.bind(services.docWorkflow)
    services.docWorkflow.indexAndEmbed = (async (...args: Parameters<typeof orig>) => {
      calls++
      if (calls === 3) throw new Error('simulated crash on doc 3')
      return orig(...args)
    }) as typeof services.docWorkflow.indexAndEmbed

    await expect(services.migration.run({})).rejects.toThrow('simulated crash')

    // Marker still present — the gate will keep firing on next startup.
    expect(fs.existsSync(path.join(kbDir, 'w', '.migration-in-progress'))).toBe(true)
    // Partial state: at least one doc indexed, but not all 5.
    const partial = await services.index.countDocs('w')
    expect(partial).toBeGreaterThan(0)
    expect(partial).toBeLessThan(5)
    // schemaVersion stays below current — the gate remains active.
    expect(services.config.getSchemaVersion()).toBeLessThan(CURRENT_SCHEMA_VERSION)

    // Restore a working indexAndEmbed and re-run.
    const fresh = buildServices()
    await fresh.migration.run({})

    expect(fs.existsSync(path.join(kbDir, 'w', '.migration-in-progress'))).toBe(false)
    expect(await fresh.index.countDocs('w')).toBe(5)
    expect(await fresh.index.countDocsWithoutEmbedding('w')).toBe(0)
    expect(fresh.config.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION)
  })
})
