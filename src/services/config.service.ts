import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import type { WikiRef } from '../types/wiki-ref.js'
import { RemoteConfigService } from './remote-config.service.js'

export interface KbCliConfig {
  defaultWiki: string
  embeddingModel: string
}

const DEFAULT_CONFIG: KbCliConfig = {
  defaultWiki: 'default',
  embeddingModel: 'all-MiniLM-L6-v2',
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

  loadConfig(): KbCliConfig {
    this.ensureDataDir()
    if (!fs.existsSync(this.configPath)) {
      return { ...DEFAULT_CONFIG }
    }
    const raw = fs.readFileSync(this.configPath, 'utf-8')
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
  }

  saveConfig(config: KbCliConfig): void {
    this.ensureDataDir()
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8')
  }

  get(key: keyof KbCliConfig): string {
    const config = this.loadConfig()
    return config[key]
  }

  set(key: keyof KbCliConfig, value: string): void {
    const config = this.loadConfig()
    config[key] = value
    this.saveConfig(config)
  }
}
