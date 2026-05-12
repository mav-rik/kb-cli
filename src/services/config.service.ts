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
    this.configPath = path.join(this.getDataDir(), 'config.json')
    this.cwdConfig = this.loadCwdConfig()
    this.remoteConfig = new RemoteConfigService(this.getDataDir())
  }

  getDataDir(): string {
    return path.join(os.homedir(), '.kb')
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
        pat: remoteInfo.pat,
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
