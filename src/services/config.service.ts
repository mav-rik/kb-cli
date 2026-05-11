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

export class ConfigService {
  private configPath: string

  constructor() {
    this.configPath = path.join(this.getDataDir(), 'config.json')
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
