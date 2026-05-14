import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import type { WikiRef } from '../types/wiki-ref.js'
import { RemoteConfigService } from './remote-config.service.js'

/**
 * Current schema version expected by this build of kb-wiki.
 *
 * Bump whenever existing user data on disk needs explicit migration
 * (schema-level changes that schema-sync can't handle, or data backfills
 * such as re-embedding under a new model / dimension).
 *
 * Version history:
 *   0  — pre-versioned (legacy 384-dim VectorService, no `embedding` column)
 *   1  — atscript-db native vectors + 768-dim Xenova/bge-base-en-v1.5
 *   2  — heading-based chunks + contentless chunks_fts; Document.embedding is centroid of chunk embeddings; documents_fts dropped
 */
export const CURRENT_SCHEMA_VERSION = 2

export interface KbCliConfig {
  defaultWiki: string
  embeddingModel: string
  schemaVersion?: number
}

const DEFAULT_CONFIG: KbCliConfig = {
  defaultWiki: 'default',
  embeddingModel: 'Xenova/bge-base-en-v1.5',
}

export interface CwdConfig {
  wiki?: string
}

export class ConfigService {
  private configPath: string
  private cwdConfig: CwdConfig | null = null
  private remoteConfig: RemoteConfigService

  constructor() {
    this.migrateLegacyDataDir()
    this.configPath = path.join(this.getDataDir(), 'config.json')
    this.cwdConfig = this.loadCwdConfig()
    this.remoteConfig = new RemoteConfigService(this.getDataDir())
  }

  getDataDir(): string {
    return path.join(os.homedir(), '.kb')
  }

  private getLegacyDataDir(): string {
    return path.join(os.homedir(), '.ai-memory')
  }

  private migrateLegacyDataDir(): void {
    const legacy = this.getLegacyDataDir()
    const target = this.getDataDir()
    if (!fs.existsSync(legacy)) return

    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(legacy, { withFileTypes: true })
    } catch {
      return
    }

    const candidates = entries
      .map((entry) => ({ entry, src: path.join(legacy, entry.name) }))
      .filter(({ entry, src }) => this.isKbArtifact(entry, src))

    if (candidates.length === 0) {
      this.cleanupEmptyDir(legacy)
      return
    }

    this.ensureDataDir()
    let migrated = 0
    for (const { entry, src } of candidates) {
      const dst = path.join(target, entry.name)
      if (fs.existsSync(dst)) continue // don't overwrite — the .kb copy wins
      try {
        fs.renameSync(src, dst)
        migrated++
      } catch (err) {
        process.stderr.write(
          `kb: failed to migrate ${src} → ${dst}: ${(err as Error).message}\n`,
        )
      }
    }

    if (migrated > 0) {
      process.stderr.write(
        `kb: migrated ${migrated} legacy artifact(s) from ${legacy} → ${target}\n`,
      )
    }

    this.cleanupEmptyDir(legacy)
  }

  private cleanupEmptyDir(dir: string): void {
    try {
      if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
    } catch {}
  }

  private isKbArtifact(entry: fs.Dirent, fullPath: string): boolean {
    if (!entry.isDirectory()) {
      return entry.name === 'config.json' || entry.name === 'remotes.json'
    }
    if (entry.name === '.models') return true
    if (fs.existsSync(path.join(fullPath, 'index.db'))) return true
    if (fs.existsSync(path.join(fullPath, 'docs'))) return true
    return false
  }

  private ensureDataDir(): void {
    const dir = this.getDataDir()
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
  }

  private loadCwdConfig(): CwdConfig | null {
    let dir = process.cwd()
    const root = path.parse(dir).root
    while (dir !== root) {
      const configPath = path.join(dir, 'kb.config.json')
      if (fs.existsSync(configPath)) {
        try {
          return JSON.parse(fs.readFileSync(configPath, 'utf-8'))
        } catch {
          return null
        }
      }
      dir = path.dirname(dir)
    }
    return null
  }

  resolveWiki(explicit?: string): WikiRef {
    const name = explicit || this.cwdConfig?.wiki || this.get('defaultWiki')
    const remoteInfo = this.remoteConfig.resolveRemoteWiki(name)
    if (remoteInfo) {
      return {
        type: 'remote',
        name: remoteInfo.wikiName,
        localAlias: name,
        remoteKb: remoteInfo.remoteName,
        url: remoteInfo.url,
        secret: remoteInfo.secret,
      }
    }
    return { type: 'local', name }
  }

  resolveWikiName(explicit?: string): string {
    const ref = this.resolveWiki(explicit)
    return ref.name
  }

  /**
   * Source of the resolved default wiki — distinguishes the cwd-pinned case
   * (kb.config.json in the project tree) from the global default.
   */
  defaultWikiSource(): 'cwd' | 'global' {
    return this.cwdConfig?.wiki ? 'cwd' : 'global'
  }

  loadConfig(): KbCliConfig {
    this.ensureDataDir()
    if (!fs.existsSync(this.configPath)) {
      // Fresh install: if there are no existing wikis on disk, stamp the
      // current schemaVersion so a brand-new user never trips the
      // migration gate. If wikis do exist (e.g. someone deleted only the
      // config), leave schemaVersion off so the gate fires.
      const fresh: KbCliConfig = { ...DEFAULT_CONFIG }
      if (!this.hasAnyWiki()) {
        fresh.schemaVersion = CURRENT_SCHEMA_VERSION
        try {
          this.saveConfig(fresh)
        } catch {
          // best-effort; the in-memory value is correct either way
        }
      }
      return fresh
    }
    const raw = fs.readFileSync(this.configPath, 'utf-8')
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
  }

  saveConfig(config: KbCliConfig): void {
    this.ensureDataDir()
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8')
  }

  get(key: 'defaultWiki' | 'embeddingModel'): string {
    const config = this.loadConfig()
    return config[key] as string
  }

  set(key: 'defaultWiki' | 'embeddingModel', value: string): void {
    const config = this.loadConfig()
    config[key] = value
    this.saveConfig(config)
  }

  /**
   * Read the schemaVersion stamped in the global config.
   * Returns 0 for legacy installs where the field is missing.
   */
  getSchemaVersion(): number {
    const config = this.loadConfig()
    return typeof config.schemaVersion === 'number' ? config.schemaVersion : 0
  }

  /**
   * Persist a new schemaVersion (called by MigrationService.run on success).
   */
  setSchemaVersion(v: number): void {
    const config = this.loadConfig()
    config.schemaVersion = v
    this.saveConfig(config)
  }

  /**
   * Synchronous, cheap check: does the data dir contain any wiki?
   * A "wiki" is any subdirectory with either `docs/` or `index.db`.
   */
  private hasAnyWiki(): boolean {
    const dataDir = this.getDataDir()
    if (!fs.existsSync(dataDir)) return false

    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dataDir, { withFileTypes: true })
    } catch {
      return false
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.')) continue
      const sub = path.join(dataDir, entry.name)
      if (
        fs.existsSync(path.join(sub, 'docs')) ||
        fs.existsSync(path.join(sub, 'index.db'))
      ) {
        return true
      }
    }
    return false
  }
}
