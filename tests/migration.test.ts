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
const { FtsService } = await import('../src/services/fts.service.js')
const { StorageService } = await import('../src/services/storage.service.js')
const { ParserService } = await import('../src/services/parser.service.js')
const { WikiManagementService } = await import('../src/services/wiki-management.service.js')
const { MigrationService } = await import('../src/services/migration.service.js')

const kbDir = path.join(tmpDir, '.kb')

function freshKbDir() {
  if (fs.existsSync(kbDir)) fs.rmSync(kbDir, { recursive: true, force: true })
  fs.mkdirSync(kbDir, { recursive: true })
}

function buildServices() {
  const config = new ConfigService()
  const parser = new ParserService()
  const storage = new StorageService(config, parser)
  const index = new IndexService(config)
  const fts = new FtsService(config)
  const embedding = new EmbeddingService(config)
  const wikis = new WikiManagementService(config)

  // Replace the real model loader with a deterministic 768-float stub so
  // tests stay offline. We patch both embed and embedBatch — the migration
  // path only uses embedBatch but other call sites might use embed.
  const fakeVec = () => new Float32Array(768).fill(0.001)
  embedding.embedBatch = async (texts: string[]) => texts.map(() => fakeVec())
  embedding.embed = async () => fakeVec()
  embedding.init = async () => undefined

  const migration = new MigrationService(config, index, embedding, fts, storage, parser, wikis)

  return { config, parser, storage, index, fts, embedding, wikis, migration }
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
    // Best-effort: close out any open DBs by clearing the require cache
    // would be nicer, but vitest re-imports between files. We just wipe.
    if (fs.existsSync(kbDir)) fs.rmSync(kbDir, { recursive: true, force: true })
  })

  it('fresh install: detectNeeded false, schemaVersion stamped on first load', () => {
    const { config, migration } = buildServices()
    // loadConfig triggers the fresh-install branch on first call.
    const loaded = config.loadConfig()
    expect(loaded.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(migration.detectNeeded()).toBe(false)

    // The config file should now exist on disk.
    const onDisk = JSON.parse(fs.readFileSync(path.join(kbDir, 'config.json'), 'utf-8'))
    expect(onDisk.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('legacy wiki without schemaVersion triggers detectNeeded=true', () => {
    // Pre-populate a wiki dir + dummy index.db (empty file is fine; the
    // existence of the index.db / docs dir is what hasAnyWiki checks).
    writeMarkdown('legacy', 'foo', '# Foo\n\nhello')
    fs.writeFileSync(path.join(kbDir, 'legacy', 'index.db'), '')
    // Note: NO config.json present. loadConfig sees wikis, so it does NOT
    // stamp schemaVersion, and getSchemaVersion returns 0 -> needs migration.
    const { migration } = buildServices()
    expect(migration.detectNeeded()).toBe(true)
  })

  it('marker file forces detectNeeded=true even if schemaVersion is current', () => {
    // Stamp the current schemaVersion explicitly.
    fs.writeFileSync(
      path.join(kbDir, 'config.json'),
      JSON.stringify({ defaultWiki: 'default', schemaVersion: CURRENT_SCHEMA_VERSION }),
      'utf-8',
    )
    // Create a wiki with a leftover marker (simulates a crashed mid-run).
    fs.mkdirSync(path.join(kbDir, 'work', 'docs'), { recursive: true })
    fs.writeFileSync(path.join(kbDir, 'work', '.migration-in-progress'), '', 'utf-8')

    const { migration } = buildServices()
    expect(migration.detectNeeded()).toBe(true)
  })

  it('plan reports per-wiki counts across multiple wikis', async () => {
    // Two wikis with docs on disk. Opening DbSpace via plan() will
    // create the schema fresh — no existing rows, so all docs are
    // "needing embedding".
    writeMarkdown('alpha', 'a1', 'alpha doc one')
    writeMarkdown('alpha', 'a2', 'alpha doc two')
    writeMarkdown('beta', 'b1', 'beta doc one')

    const { migration } = buildServices()
    const plan = await migration.plan()
    expect(plan.schemaVersionTo).toBe(CURRENT_SCHEMA_VERSION)
    const names = plan.wikis.map((w) => w.name).sort()
    expect(names).toEqual(['alpha', 'beta'])

    // Schema is freshly created, so documents table is empty; nothing
    // "needs embedding" yet (rows don't exist). The migration will
    // create them in run().
    const alpha = plan.wikis.find((w) => w.name === 'alpha')!
    const beta = plan.wikis.find((w) => w.name === 'beta')!
    expect(alpha.totalDocs).toBe(0)
    expect(alpha.needingEmbedding).toBe(0)
    expect(beta.totalDocs).toBe(0)
  })

  it('run is idempotent: second invocation is a no-op', async () => {
    writeMarkdown('w', 'first', 'first body')
    writeMarkdown('w', 'second', 'second body')

    const { migration, config, index } = buildServices()
    const calls: Array<[number, number]> = []
    await migration.run({
      onProgress: (_w, done, total) => {
        calls.push([done, total])
      },
    })
    expect(config.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION)

    // Both docs were embedded.
    expect(await index.countDocs('w')).toBe(2)
    expect(await index.countDocsWithoutEmbedding('w')).toBe(0)

    // Second run: schemaVersion already current, nothing should change.
    // We snapshot (id, contentHash, hasEmbedding) per row — these are
    // the user-visible bits the migration should not touch when
    // re-invoked against an already-current DB.
    const before = (await index.listDocsForMigration('w')).sort((a, b) =>
      a.id.localeCompare(b.id),
    )
    await migration.run({})
    const after = (await index.listDocsForMigration('w')).sort((a, b) =>
      a.id.localeCompare(b.id),
    )
    expect(after).toEqual(before)

    // Marker file is cleaned up.
    expect(fs.existsSync(path.join(kbDir, 'w', '.migration-in-progress'))).toBe(false)
  })

  it('run drops legacy documents_vec table if present', async () => {
    writeMarkdown('w', 'only', 'body')

    // Pre-create the wiki dir + an index.db with the legacy shadow table.
    const dbPath = path.join(kbDir, 'w', 'index.db')
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    // Use the same better-sqlite3 the app uses to create the legacy table.
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
})
