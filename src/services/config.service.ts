import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

export interface AiMemoryConfig {
  defaultKb: string
  dataDir: string
  embeddingModel: string
}

const DEFAULT_CONFIG: AiMemoryConfig = {
  defaultKb: 'default',
  dataDir: '~/.ai-memory',
  embeddingModel: 'all-MiniLM-L6-v2',
}

export interface CwdConfig {
  kb?: string
}

export class ConfigService {
  private configPath: string
  private cwdConfig: CwdConfig | null = null

  constructor() {
    this.configPath = path.join(this.getDataDir(), 'config.json')
    this.cwdConfig = this.loadCwdConfig()
  }

  getDataDir(): string {
    return path.join(os.homedir(), '.ai-memory')
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
      const configPath = path.join(dir, 'aimem.config.json')
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

  resolveKb(explicit?: string): string {
    if (explicit) return explicit
    if (this.cwdConfig?.kb) return this.cwdConfig.kb
    return this.get('defaultKb')
  }

  loadConfig(): AiMemoryConfig {
    this.ensureDataDir()
    if (!fs.existsSync(this.configPath)) {
      return { ...DEFAULT_CONFIG }
    }
    const raw = fs.readFileSync(this.configPath, 'utf-8')
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
  }

  saveConfig(config: AiMemoryConfig): void {
    this.ensureDataDir()
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8')
  }

  get(key: keyof AiMemoryConfig): string {
    const config = this.loadConfig()
    return config[key]
  }

  set(key: keyof AiMemoryConfig, value: string): void {
    const config = this.loadConfig()
    ;(config as Record<string, string>)[key] = value
    this.saveConfig(config)
  }
}
