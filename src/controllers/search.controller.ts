import { Controller, Cli, Param, CliOption, Description, Optional } from '@moostjs/event-cli'
import { services } from '../services/container.js'
import { SearchResult, SearchMode } from '../services/search.service.js'
import { toDocId, toFilename } from '../utils/slug.js'

@Controller()
export class SearchController {
  private get config() { return services.config }
  private get gateway() { return services.gateway }

  @Cli('search/:query')
  @Description('Search documents (hybrid semantic + keyword)')
  async search(
    @Param('query') query: string,
    @Description('Max results') @CliOption('limit', 'n') @Optional() limit: string,
    @Description('Search mode: hybrid, fts, vec') @CliOption('mode', 'm') @Optional() mode: string,
    @Description('Output format') @CliOption('format') @Optional() format: string,
    @Description('Wiki') @CliOption('wiki', 'w') @Optional() wiki: string,
  ): Promise<string | object> {
    const parsedLimit = limit ? parseInt(limit, 10) : 10
    const ref = this.config.resolveWiki(wiki)
    const ops = this.gateway.getOps(ref)
    const searchMode = (mode === 'fts' || mode === 'vec') ? mode : 'hybrid' as SearchMode

    const results = await ops.search(query, parsedLimit, searchMode)

    if (results.length === 0) {
      return 'No results found.'
    }

    if (format === 'json') {
      return JSON.stringify(results, null, 2)
    }

    return this.formatTable(query, results)
  }

  @Cli('related/:id')
  @Description('Find documents related to a given document')
  async related(
    @Param('id') id: string,
    @Description('Max results') @CliOption('limit', 'n') @Optional() limit: string,
    @Description('Output format') @CliOption('format') @Optional() format: string,
    @Description('Wiki') @CliOption('wiki', 'w') @Optional() wiki: string,
  ): Promise<string | object> {
    const parsedLimit = limit ? parseInt(limit, 10) : 10
    const ref = this.config.resolveWiki(wiki)
    const ops = this.gateway.getOps(ref)
    const docId = toDocId(toFilename(id))

    const results = await ops.related(docId, parsedLimit)

    if (results.length === 0) {
      return 'No related documents found.'
    }

    if (format === 'json') {
      return JSON.stringify(results, null, 2)
    }

    return this.formatTable(`related to "${docId}"`, results)
  }

  private formatTable(query: string, results: SearchResult[]): string {
    const lines: string[] = []
    lines.push(`Search results for ${query} (${results.length} results):`)
    lines.push('')

    // Calculate dynamic column width for ID (never truncate)
    const maxIdLen = Math.max(4, ...results.map(r => r.id.length))

    lines.push(` # | Score | ${'ID'.padEnd(maxIdLen)} | Category | Title`)
    lines.push(`---|-------|${''.padEnd(maxIdLen, '-')}--|----------|------`)

    for (let i = 0; i < results.length; i++) {
      const r = results[i]
      const num = String(i + 1).padStart(2, ' ')
      const score = r.score.toFixed(3).padStart(5, ' ')
      const id = r.id.padEnd(maxIdLen)
      const category = r.category.padEnd(8, ' ').slice(0, 8)
      lines.push(`${num} | ${score} | ${id} | ${category} | ${r.title}`)
    }

    return lines.join('\n')
  }
}
