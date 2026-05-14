import * as fs from 'node:fs'
import * as path from 'node:path'
import { ConfigService, CURRENT_SCHEMA_VERSION } from './config.service.js'
import { IndexService } from './index.service.js'
import { StorageService } from './storage.service.js'
import { WikiManagementService } from './wiki-management.service.js'
import { DocWorkflowService } from './doc-workflow.service.js'
import { toDocId } from '../utils/slug.js'

const MARKER_FILE = '.migration-in-progress'
const LEGACY_MODEL_DIR = 'models--Xenova--all-MiniLM-L6-v2'

export interface MigrationPlanWiki {
  name: string
  totalDocs: number
  hasLegacyVec: boolean
  hasLegacyFts: boolean
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
    private storage: StorageService,
    private wikis: WikiManagementService,
    private docWorkflow: DocWorkflowService,
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
   * `embedding` column + vec0 shadow + chunks table if they are missing.
   */
  async plan(opts: { wiki?: string } = {}): Promise<MigrationPlan> {
    const wikiNames = this.scopedWikis(opts.wiki)

    const wikis: MigrationPlanWiki[] = []
    for (const name of wikiNames) {
      // Opening the space runs syncSchema, which adds the embedding
      // column + vec0 shadow + chunks table if a legacy DB lacks them.
      await this.index.getSpace(name)

      const totalDocs = this.storage.listFiles(name).length
      const hasLegacyVec = await this.index.hasLegacyVecTable(name)
      const hasLegacyFts = await this.index.hasLegacyFtsTable(name)
      const hasMarker = fs.existsSync(this.markerPath(name))

      wikis.push({
        name,
        totalDocs,
        hasLegacyVec,
        hasLegacyFts,
        hasMarker,
      })
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
   * migrated + its legacy tables dropped. If any wiki fails,
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

  // v1→v2 builds chunks for every doc; no skip-embed because chunks don't exist yet.
  private async migrateOne(kb: string, onProgress?: MigrationProgress): Promise<void> {
    this.writeMarker(kb)

    await this.index.getSpace(kb)

    const files = this.storage.listFiles(kb)
    if (onProgress && files.length === 0) onProgress(kb, 0, 0, 'no docs')

    let done = 0
    for (const filename of files) {
      // readDoc throws on missing/corrupt files (readFileSync + frontmatter parse);
      // skip those rather than aborting the whole wiki. indexAndEmbed errors
      // stay uncaught so the wiki retains its marker for resume.
      let doc
      try {
        doc = this.storage.readDoc(kb, filename)
      } catch {
        doc = null
      }
      if (doc) {
        await this.docWorkflow.indexAndEmbed(kb, toDocId(filename), doc.frontmatter)
      }
      done++
      if (onProgress) onProgress(kb, done, files.length, doc?.frontmatter.title || filename)
    }

    // Drop legacy tables now that the new substrate is populated.
    await this.index.dropLegacyFtsTable(kb)
    await this.index.dropLegacyVecTable(kb)

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
