import { Controller, Cli, Param, Description } from '@moostjs/event-cli'
import { services } from '../services/container.js'

@Controller('config')
export class ConfigController {
  private get config() { return services.config }

  @Cli('get/:key')
  @Description('Get a config value')
  get(@Param('key') key: string) {
    const value = this.config.get(key as any)
    if (value === undefined) {
      return `Unknown config key: ${key}`
    }
    return `${key}=${value}`
  }

  @Cli('set/:key/:value')
  @Description('Set a config value')
  set(@Param('key') key: string, @Param('value') value: string) {
    this.config.set(key as any, value)
    return `Set ${key}=${value}`
  }

  @Cli('list')
  @Description('List all config values')
  list() {
    const config = this.config.loadConfig()
    return Object.entries(config)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n')
  }
}
