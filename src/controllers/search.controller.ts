import { Controller, Cli, Param, CliOption, Description, Optional } from '@moostjs/event-cli'
import { services } from '../services/container.js'
import { SearchMode } from '../services/search.service.js'
import { toDocId, toFilename } from '../utils/slug.js'
import { WikiName, DocHandle } from '../models/api-bodies.as'

@Controller()
export class SearchController {
  private get config() { return services.config }
  private get gateway() { return services.gateway }

  @Cli('search/:query')
  @Description('Search documents at chunk level (H2/H3 sections). Default mode (`hybrid`) fuses semantic embedding similarity with BM25 keyword matching via Reciprocal Rank Fusion — best for natural-language queries. Each result includes the source filename, line range, and section heading path.')
  async search(
    @Description('Search query. Natural language works well in hybrid/vec modes; in fts mode it is parsed as an FTS5 query (supports `AND`, `OR`, `NEAR`, quoted phrases).') @Param('query') query: string,
    @Description('Maximum number of chunk results to return. Default: 10. Each result is one chunk; a single doc can return up to 2 chunks.') @CliOption('limit', 'n') @Optional() limit: string,
    @Description('Search mode. `hybrid` (default) = embeddings + BM25 fused. `fts` = BM25 keyword only (no model load, fastest). `vec` = embeddings only (no keyword boost).') @CliOption('mode', 'm') @Optional() mode: string,
    @Description('Output format. Default: human-readable list. Use --format json for the raw array of result objects.') @CliOption('format') @Optional() format: string,
    @Description('Target wiki name. Defaults to the wiki resolved from `kb.config.json` in the current directory, falling back to the global `defaultWiki`. Run `kb wiki list` to see available wikis.') @CliOption('wiki', 'w') @Optional() wiki: WikiName,
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
  @Description('Find documents semantically similar to a given doc. Embeds the source doc\'s title + body intro and runs vector similarity against all other doc-level embeddings. Use to discover existing context before adding new docs and avoid duplication.')
  async related(
    @Description('Source doc handle (canonical id / filename / `./path`). The doc itself is excluded from the results.') @Param('id') id: DocHandle,
    @Description('Maximum number of related docs to return. Default: 10.') @CliOption('limit', 'n') @Optional() limit: string,
    @Description('Output format. Default: human-readable list with similarity scores. Use --format json for the raw array.') @CliOption('format') @Optional() format: string,
    @Description('Target wiki name. Defaults to the wiki resolved from `kb.config.json` in the current directory, falling back to the global `defaultWiki`. Run `kb wiki list` to see available wikis.') @CliOption('wiki', 'w') @Optional() wiki: WikiName,
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
