import { Controller, Cli, Description } from '@moostjs/event-cli'
import { services } from '../services/container.js'
import { CURRENT_SCHEMA_VERSION } from '../services/config.service.js'

@Controller()
export class StatusController {
  @Cli('status')
  @Description('Show local environment status (server, config, schema, wikis)')
  status(): string {
    const lines: string[] = []
    const config = services.config
    const dataDir = config.getDataDir()
    const effectiveDefault = config.resolveWikiName()
    const defaultSource = config.defaultWikiSource()
    const configuredModel = config.get('embeddingModel')
    const schemaVersion = config.getSchemaVersion()
    const wikis = services.wikiManagement.list().sort()
    const serverInfo = services.localServer.getCached()

    lines.push('Local server:')
    if (serverInfo) {
      lines.push(
        `  running — pid ${serverInfo.pid}, port ${serverInfo.port}, started ${serverInfo.startedAt}`,
      )
      lines.push('  Routing this command through the server.')
    } else {
      lines.push('  not running')
      lines.push('  This command would load the embedding model in-process.')
    }
    lines.push('')

    lines.push('Embedding model:')
    if (serverInfo) {
      lines.push(`  Configured (config.json): ${configuredModel}`)
      lines.push(`  Loaded by server:         ${serverInfo.embeddingModel}`)
      if (serverInfo.embeddingModel !== configuredModel) {
        lines.push(
          `  ⚠ Mismatch — searches use the server's model. Restart the server to pick up the new config.`,
        )
      }
    } else {
      lines.push(`  ${configuredModel}`)
    }
    lines.push('')

    lines.push(
      `Schema version: ${schemaVersion}${schemaVersion === CURRENT_SCHEMA_VERSION ? ' (current)' : ` (needs upgrade — run \`kb migrate\`)`}`,
    )
    lines.push(`Data dir: ${dataDir}`)
    lines.push(`Default wiki: ${effectiveDefault} (${defaultSource === 'cwd' ? 'kb.config.json' : 'global config'})`)
    lines.push(`Wikis (${wikis.length}): ${wikis.length ? wikis.join(', ') : '<none>'}`)

    return lines.join('\n')
  }
}
