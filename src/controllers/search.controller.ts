import { Controller, Cli, Param, CliOption, Description, Optional } from '@moostjs/event-cli'
import { services } from '../services/container.js'
import { SearchMode } from '../services/search.service.js'
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

    if (results.length === 0) return 'No results found.'
    if (format === 'json') return JSON.stringify(results, null, 2)

    return formatResults(`Search results for ${query}`, results, (r) => {
      const [from, to] = r.lines
      const heading = r.headingPath ?? r.heading ?? '(intro)'
      return [`${r.filename}:${from}-${to}`, heading]
    })
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

    if (results.length === 0) return 'No related documents found.'
    if (format === 'json') return JSON.stringify(results, null, 2)

    return formatResults(`Related to "${docId}"`, results, (r) => [r.filename, r.title])
  }
}

function formatResults<T extends { score: number; snippet: string }>(
  header: string,
  results: T[],
  describe: (r: T) => [primary: string, secondary: string],
): string {
  const lines: string[] = [`${header} (${results.length} results):`, '']
  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    const [primary, secondary] = describe(r)
    lines.push(`${i + 1}. ${primary}  (${r.score.toFixed(3)})`)
    lines.push(`   ${secondary}`)
    if (r.snippet) lines.push(`   ${r.snippet}`)
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}
