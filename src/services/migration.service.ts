import * as fs from 'node:fs'
import * as path from 'node:path'
import { ConfigService, CURRENT_SCHEMA_VERSION } from './config.service.js'
import { IndexService } from './index.service.js'
import { EmbeddingService } from './embedding.service.js'
import { FtsService } from './fts.service.js'
import { StorageService } from './storage.service.js'
import { ParserService } from './parser.service.js'
import { WikiManagementService } from './wiki-management.service.js'
import { toDocId } from '../utils/slug.js'
import { contentHash } from '../utils/hash.js'
import { chunk } from '../utils/chunk.js'

const MARKER_FILE = '.migration-in-progress'
const LEGACY_MODEL_DIR = 'models--Xenova--all-MiniLM-L6-v2'
const BATCH_SIZE = 25

export interface MigrationPlanWiki {
  name: string
  totalDocs: number
  needingEmbedding: number
  hasLegacyVec: boolean
  hasMarker: boolean
}

export interface MigrationPlan {
  schemaVersionFrom: number
  schemaVersionTo: number
  wikis: MigrationPlanWiki[]
  legacyModelToRemove: string | null
}

export type MigrationProgress = (
  wiki: string,
  done: number,
  total: number,
  label: string,
) => void

export interface MigrationRunOptions {
  wiki?: string
  onProgress?: MigrationProgress
}

export class MigrationService {
  constructor(
    private config: ConfigService,
    private index: IndexService,
    private embedding: EmbeddingService,
    private fts: FtsService,
    private storage: StorageService,
    private parser: ParserService,
    private wikis: WikiManagementService,
  ) {}

  /**
   * Cheap, synchronous check called from the CLI startup gate.
   * True iff:
   *   - the global config schemaVersion is below CURRENT_SCHEMA_VERSION, OR
   *   - any wiki has a leftover `.migration-in-progress` marker (resumable).
   */
  detectNeeded(): boolean {
    if (this.config.getSchemaVersion() < CURRENT_SCHEMA_VERSION) return true

    const dataDir = this.config.getDataDir()
    if (!fs.existsSync(dataDir)) return false

    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dataDir, { withFileTypes: true })
    } catch {
      return false
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const marker = path.join(dataDir, entry.name, MARKER_FILE)
      if (fs.existsSync(marker)) return true
    }
    return false
  }

  /**
   * Enumerate local wikis and report per-wiki migration state.
   * Opens each wiki's DbSpace which (via syncSchema) adds the
   * `embedding` column + vec0 shadow + triggers if they are missing.
   */
  async plan(opts: { wiki?: string } = {}): Promise<MigrationPlan> {
    const wikiNames = this.scopedWikis(opts.wiki)

    const wikis: MigrationPlanWiki[] = []
    for (const name of wikiNames) {
      // Opening the space runs syncSchema, which adds the embedding
      // column + vec0 shadow + triggers if a legacy DB lacks them.
      await this.index.getSpace(name)

      const totalDocs = await this.index.countDocs(name)
      const needingEmbedding = await this.index.countDocsWithoutEmbedding(name)
      const hasLegacyVec = await this.index.hasLegacyVecTable(name)
      const hasMarker = fs.existsSync(this.markerPath(name))

      wikis.push({ name, totalDocs, needingEmbedding, hasLegacyVec, hasMarker })
    }

    const legacyModelPath = path.join(
      this.config.getDataDir(),
      '.models',
      LEGACY_MODEL_DIR,
    )
    const legacyModelToRemove = fs.existsSync(legacyModelPath) ? legacyModelPath : null

    return {
      schemaVersionFrom: this.config.getSchemaVersion(),
      schemaVersionTo: CURRENT_SCHEMA_VERSION,
      wikis,
      legacyModelToRemove,
    }
  }

  /**
   * Apply the migration. Resumable: a per-wiki marker file is written
   * before mutating the DB and removed only after the wiki is fully
   * migrated + its legacy vec table dropped. If any wiki fails,
   * schemaVersion is NOT bumped — the CLI gate stays on.
   */
  async run(opts: MigrationRunOptions = {}): Promise<void> {
    const scope = this.scopedWikis(opts.wiki)

    if (scope.length === 0) {
      // No wikis to migrate, but we still bump the version (covers
      // the "deleted all wikis then upgraded" edge case).
      this.config.setSchemaVersion(CURRENT_SCHEMA_VERSION)
      return
    }

    for (const name of scope) {
      await this.migrateOne(name, opts.onProgress)
    }

    // All wikis succeeded — finalize.
    try {
      this.config.setSchemaVersion(CURRENT_SCHEMA_VERSION)
    } catch {
      // best-effort
    }

    // Clean up legacy 384-dim model cache.
    const legacyModelPath = path.join(
      this.config.getDataDir(),
      '.models',
      LEGACY_MODEL_DIR,
    )
    if (fs.existsSync(legacyModelPath)) {
      try {
        fs.rmSync(legacyModelPath, { recursive: true, force: true })
      } catch {
        // best-effort — non-fatal
      }
    }
  }

  private async migrateOne(kb: string, onProgress?: MigrationProgress): Promise<void> {
    // 1) Write the resumability marker BEFORE any DB mutation. If we
    //    crash mid-run, detectNeeded() will see the marker on next start
    //    and re-gate the CLI.
    this.writeMarker(kb)

    // 2) Open the space — adds embedding column / vec0 shadow / triggers
    //    if missing (the schema half of the migration).
    await this.index.getSpace(kb)

    // 3) Collect every markdown file and decide what kind of reindex
    //    each one needs.
    const files = this.storage.listFiles(kb)
    const total = files.length

    // Pre-compute existing row state in a single query so we don't N+1
    // against atscript-db.
    const existingRows = await this.index.listDocsForMigration(kb)
    const existing = new Map<string, { contentHash: string; hasEmbedding: boolean }>()
    for (const r of existingRows) {
      existing.set(r.id, { contentHash: r.contentHash, hasEmbedding: r.hasEmbedding })
    }

    // Plan the work: for each file decide if a full reindex is needed
    // (row missing or stale) or an embedding-only update is sufficient.
    interface Work {
      filename: string
      docId: string
      body: string
      title: string
      category: string
      tags: string[]
      hash: string
      mode: 'reindex' | 'embed'
    }
    const todo: Work[] = []
    for (const filename of files) {
      let doc
      try {
        doc = this.storage.readDoc(kb, filename)
      } catch {
        continue
      }
      const docId = toDocId(filename)
      const hash = contentHash(doc.body)
      const existingRow = existing.get(docId)

      let mode: 'reindex' | 'embed' | null = null
      if (!existingRow) {
        mode = 'reindex'
      } else if (existingRow.contentHash !== hash) {
        mode = 'reindex'
      } else if (!existingRow.hasEmbedding) {
        mode = 'embed'
      }

      if (mode) {
        todo.push({
          filename,
          docId,
          body: doc.body,
          title: doc.frontmatter.title,
          category: doc.frontmatter.category,
          tags: doc.frontmatter.tags || [],
          hash,
          mode,
        })
      }
    }

    if (onProgress && todo.length === 0 && total > 0) {
      onProgress(kb, 0, 0, 'already current')
    }

    // 4) Process in batches of 25 using embedBatch.
    let done = 0
    for (const batch of chunk(todo, BATCH_SIZE)) {
      const texts = batch.map((w) => w.body || w.title)
      const vectors = await this.embedding.embedBatch(texts)

      for (let j = 0; j < batch.length; j++) {
        const w = batch[j]
        const vec = vectors[j]
        if (w.mode === 'reindex') {
          await this.index.upsertDoc(kb, {
            id: w.docId,
            title: w.title,
            category: w.category,
            tags: w.tags,
            filePath: w.filename,
            contentHash: w.hash,
          })
          // refresh outbound links + FTS — keeps the index coherent with
          // the markdown source of truth.
          const links = this.parser.extractLinks(w.body)
          await this.index.upsertLinks(
            kb,
            w.docId,
            links.map((l) => ({ toId: toDocId(l.target), linkText: l.text })),
          )
          this.fts.upsert(kb, w.docId, w.title, w.tags, w.body)
        }
        await this.index.setEmbedding(kb, w.docId, vec)
        done++
      }

      const last = batch[batch.length - 1]
      if (onProgress) onProgress(kb, done, todo.length, last.title || last.filename)
    }

    // 5) Drop the legacy `documents_vec` shadow table if present.
    await this.index.dropLegacyVecTable(kb)

    // 6) Marker removed last: the wiki is now fully migrated.
    this.removeMarker(kb)
  }

  // ---------- internals ----------

  private scopedWikis(only?: string): string[] {
    const all = this.wikis.list().sort()
    return only ? all.filter((n) => n === only) : all
  }

  private markerPath(kb: string): string {
    return path.join(this.config.getDataDir(), kb, MARKER_FILE)
  }

  private writeMarker(kb: string): void {
    const wikiDir = path.dirname(this.markerPath(kb))
    if (!fs.existsSync(wikiDir)) fs.mkdirSync(wikiDir, { recursive: true })
    // Body is informational only; presence is the actual signal.
    fs.writeFileSync(this.markerPath(kb), `${new Date().toISOString()} pid=${process.pid}\n`, 'utf-8')
  }

  private removeMarker(kb: string): void {
    const p = this.markerPath(kb)
    if (fs.existsSync(p)) {
      try {
        fs.unlinkSync(p)
      } catch {
        // best-effort
      }
    }
  }
}
