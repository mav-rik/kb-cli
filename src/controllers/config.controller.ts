import { Controller, Cli, Param, Description } from '@moostjs/event-cli'
import { services } from '../services/container.js'

@Controller('config')
export class ConfigController {
  private get config() { return services.config }

  @Cli('get/:key')
  @Description('Read one value from the global config (~/.kb/config.json). Known keys include `defaultWiki` and `embeddingModel`. Returns "Unknown config key" if the key has not been set.')
  get(@Description('Config key name, e.g. `defaultWiki`, `embeddingModel`. Run `kb config list` to see what is currently set.') @Param('key') key: string) {
    const value = this.config.get(key as any)
    if (value === undefined) {
      return `Unknown config key: ${key}`
    }
    return `${key}=${value}`
  }

  @Cli('set/:key/:value')
  @Description('Write a value into the global config (~/.kb/config.json). Affects every subsequent kb invocation that does not override the value locally. For per-project pinning of `defaultWiki`, prefer a project-level kb.config.json.')
  set(
    @Description('Config key to set, e.g. `defaultWiki`, `embeddingModel`.') @Param('key') key: string,
    @Description('New value for the key. Always stored as a string.') @Param('value') value: string,
  ) {
    this.config.set(key as any, value)
    return `Set ${key}=${value}`
  }

  @Cli('list')
  @Description('Print every key/value currently set in the global config (~/.kb/config.json). Does not show project-level kb.config.json overrides — use `kb status` to see the effective resolved values.')
  list() {
    const config = this.config.loadConfig()
    return Object.entries(config)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n')
  }
}
