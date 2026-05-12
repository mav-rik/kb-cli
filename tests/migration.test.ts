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
  const fts = new FtsService(config)
  const embedding = new EmbeddingService(config)
  const wikis = new WikiManagementService(config)

  embedding.embedBatch = async (texts: string[]) => texts.map((t) => hashedVec(t))
  embedding.embed = async (t: string) => hashedVec(t)
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

  it('semanticSearch ranks the doc matching the query vector first', async () => {
    writeMarkdown('w', 'apple', 'apple apple apple')
    writeMarkdown('w', 'banana', 'banana banana banana')
    writeMarkdown('w', 'carrot', 'carrot carrot carrot')

    const { migration, index, storage } = buildServices()
    await migration.run({})

    // Re-hash the exact body the migration embedded so the query vector
    // collides 1:1 with the banana doc and is orthogonal to the others.
    const bananaDoc = storage.readDoc('w', 'banana.md')
    const queryVec = hashedVec(bananaDoc.body)
    const hits = await index.semanticSearch('w', queryVec, 10)

    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].id).toBe('banana')
    expect(hits[0].distance).toBeLessThan(0.01)
    // The runner-up should be meaningfully more distant. Strict
    // `> 1` would fail if two unrelated bodies happen to hash to the
    // same bucket mod 768 (rare, but Birthday paradox is real).
    if (hits.length > 1) {
      expect(hits[1].distance).toBeGreaterThan(hits[0].distance + 0.5)
    }
  })

  it('embed-only mode: existing row with matching contentHash and NULL embedding', async () => {
    writeMarkdown('w', 'first', 'first body')
    writeMarkdown('w', 'second', 'second body')

    // Run the migration once to populate everything.
    const services = buildServices()
    await services.migration.run({})
    expect(await services.index.countDocsWithoutEmbedding('w')).toBe(0)

    // Capture the row metadata so we can prove the migration's "embed
    // mode" branch doesn't touch contentHash / category / title / etc.
    const before = await services.index.listDocsForMigration('w')

    // NULL out the embedding for one doc via a fresh SQLite handle.
    // The schema has vec0 triggers on `documents`, so the sqlite-vec
    // extension must be loaded before we can write to the table.
    // contentHash stays intact, so the migration must take the
    // embed-only path (NOT the full reindex path).
    const Database = (await import('better-sqlite3')).default
    const sqliteVec = await import('sqlite-vec')
    const dbPath = path.join(kbDir, 'w', 'index.db')
    const direct = new Database(dbPath)
    sqliteVec.load(direct)
    direct.exec("UPDATE documents SET embedding = NULL WHERE id = 'first'")
    direct.close()

    // Rebuild services so IndexService re-opens the DB and sees the NULL.
    const fresh = buildServices()
    expect(await fresh.index.countDocsWithoutEmbedding('w')).toBe(1)

    // Track whether reindex-only side effects fire. FTS.upsert is only
    // called on the "reindex" branch, not the "embed" branch — if it
    // fires, the wrong branch was taken.
    let ftsUpsertCalls = 0
    const origUpsert = fresh.fts.upsert.bind(fresh.fts)
    fresh.fts.upsert = ((kb: string, id: string, t: string, tg: string[], b: string) => {
      ftsUpsertCalls++
      return origUpsert(kb, id, t, tg, b)
    }) as typeof fresh.fts.upsert

    await fresh.migration.run({})

    expect(await fresh.index.countDocsWithoutEmbedding('w')).toBe(0)
    expect(ftsUpsertCalls).toBe(0) // proves embed-only path was used

    // contentHash + other metadata unchanged for both rows.
    const after = await fresh.index.listDocsForMigration('w')
    const byId = (rows: typeof after) =>
      Object.fromEntries(rows.map((r) => [r.id, r.contentHash]))
    expect(byId(after)).toEqual(byId(before))
  })

  it('crash mid-run leaves marker; next run resumes to completion', async () => {
    // 27 docs forces 2 batches at BATCH_SIZE=25.
    for (let i = 0; i < 27; i++) writeMarkdown('w', `doc${i}`, `body ${i}`)

    const services = buildServices()
    // Throw on the second embedBatch call to simulate a crash partway through.
    let batchCalls = 0
    services.embedding.embedBatch = async (texts: string[]) => {
      batchCalls++
      if (batchCalls === 2) throw new Error('simulated crash on batch 2')
      return texts.map((t) => hashedVec(t))
    }

    await expect(services.migration.run({})).rejects.toThrow('simulated crash')

    // Marker still present — the gate will keep firing on next startup.
    expect(fs.existsSync(path.join(kbDir, 'w', '.migration-in-progress'))).toBe(true)
    // upsertDoc runs INSIDE the post-embedBatch inner loop, so a crash
    // in embedBatch leaves the second batch's rows entirely unwritten.
    // Filesystem has 27 docs; DB has only what the first batch finished.
    const partial = await services.index.countDocs('w')
    expect(partial).toBeLessThan(27)
    expect(partial).toBeGreaterThan(0)
    // schemaVersion stays at 0 — the gate remains active.
    expect(services.config.getSchemaVersion()).toBe(0)

    // Restore a working embedBatch and re-run.
    const fresh = buildServices()
    await fresh.migration.run({})

    expect(fs.existsSync(path.join(kbDir, 'w', '.migration-in-progress'))).toBe(false)
    expect(await fresh.index.countDocsWithoutEmbedding('w')).toBe(0)
    expect(await fresh.index.countDocs('w')).toBe(27)
    expect(fresh.config.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION)
  })
})
