import { Controller, Cli, Param, CliOption, Description, Optional } from '@moostjs/event-cli'
import { services } from '../services/container.js'
import { SearchResult } from '../services/search.service.js'

@Controller()
export class SearchController {
  private get config() { return services.config }
  private get searchService() { return services.search }

  @Cli('search/:query')
  @Description('Search documents (hybrid semantic + keyword)')
  async search(
    @Param('query') query: string,
    @Description('Max results') @CliOption('limit', 'n') @Optional() limit: string,
    @Description('Output format') @CliOption('format') @Optional() format: string,
    @Description('Knowledge base') @CliOption('kb') @Optional() kb: string,
  ): Promise<string | object> {
    const parsedLimit = limit ? parseInt(limit, 10) : 10
    const resolvedKb = this.config.resolveKb(kb)

    const results = await this.searchService.search(resolvedKb, query, parsedLimit)

    if (results.length === 0) {
      return 'No results found.'
    }

    if (format === 'json') {
      return results
    }

    return this.formatTable(query, results)
  }

  private formatTable(query: string, results: SearchResult[]): string {
    const lines: string[] = []
    lines.push(`Search results for "${query}" (${results.length} results):`)
    lines.push('')

    lines.push(' # | Score | ID                  | Category | Title                  | Snippet')
    lines.push('---|-------|---------------------|----------|------------------------|----------------------------------')

    for (let i = 0; i < results.length; i++) {
      const r = results[i]
      const num = String(i + 1).padStart(2, ' ')
      const score = r.score.toFixed(3).padStart(5, ' ')
      const id = r.id.padEnd(19, ' ').slice(0, 19)
      const category = r.category.padEnd(8, ' ').slice(0, 8)
      const title = r.title.padEnd(22, ' ').slice(0, 22)
      const snippet = r.snippet.slice(0, 34)
      lines.push(`${num} | ${score} | ${id} | ${category} | ${title} | ${snippet}`)
    }

    return lines.join('\n')
  }
}
