import { Controller, Cli, Param, CliOption, Description, Optional } from '@moostjs/event-cli'
import { services } from '../services/container.js'
import { canonicalize, parseLineRange } from '../utils/slug.js'
import { formatDocNotFound } from '../services/wiki-ops.js'

@Controller()
export class ReadController {
  private get config() { return services.config }
  private get gateway() { return services.gateway }

  @Cli('read/:path')
  @Cli('get/:path')
  @Description('Read a document')
  async read(
    @Param('path') docPath: string,
    @Description('Line range (e.g., 1-50)') @CliOption('lines', 'l') @Optional() lines: string,
    @Description('Context lines around the range') @CliOption('context', 'c') @Optional() context: string,
    @Description('Show metadata only') @CliOption('meta', 'm') meta: boolean,
    @Description('List outgoing links') @CliOption('links') links: boolean,
    @Description('Follow a link') @CliOption('follow', 'f') @Optional() follow: string,
    @Description('Wiki') @CliOption('wiki', 'w') @Optional() wiki: string,
  ): Promise<string | object> {
    const ref = this.config.resolveWiki(wiki)
    const ops = this.gateway.getOps(ref)
    const input = follow || docPath
    const targetPath = canonicalize(input).filename

    if (!await ops.docExists(targetPath)) {
      const r = await ops.resolve(input)
      return `Error: ${formatDocNotFound({ kb: ref.name, input, suggestions: r.suggestions })}`
    }

    if (meta) {
      const doc = await ops.readDoc(targetPath)
      return doc.frontmatter
    }

    if (links) {
      const doc = await ops.readDoc(targetPath)
      if (doc.links.length === 0) {
        return 'No outgoing links.'
      }
      return doc.links.map((l) => `${l.text} -> ./${l.target}`).join('\n')
    }

    // Use absolute line numbers (file-absolute, frontmatter counted) so search hits'
    // `lines` map directly to `kb read --lines a-b` without translation.
    const ctx = context ? Math.max(0, parseInt(context, 10) || 0) : 0
    const { start, end } = parseLineRange(lines || '', ctx)
    const slice = await ops.readSlice(targetPath, start, end)

    const doc = await ops.readDoc(targetPath)
    const header = [`=== ${targetPath}:${slice.fromLine}-${slice.toLine} (of ${slice.totalLines}) ===`]
    if (doc.frontmatter.tags && doc.frontmatter.tags.length > 0) {
      header.push(`Tags: ${doc.frontmatter.tags.join(', ')}`)
    }
    if (doc.links.length > 0) {
      header.push(`Links: ${doc.links.map((l) => `./${l.target}`).join(', ')}`)
    }
    header.push('---')

    const sliceLines = slice.content === '' ? [] : slice.content.split('\n')
    const padWidth = String(slice.toLine).length
    const numbered = sliceLines.map(
      (line, i) => `${String(slice.fromLine + i).padStart(padWidth)} | ${line}`,
    )

    return [...header, ...numbered].join('\n')
  }

  @Cli('resolve/:input')
  @Description('Resolve any doc handle (id, filename, ./path, full path) to its canonical id + file')
  async resolve(
    @Param('input') input: string,
    @Description('Output format') @CliOption('format') @Optional() format: string,
    @Description('Wiki') @CliOption('wiki', 'w') @Optional() wiki: string,
  ): Promise<string | object> {
    const ref = this.config.resolveWiki(wiki)
    const ops = this.gateway.getOps(ref)
    const r = await ops.resolve(input)

    if (format === 'json') return r

    const lines: string[] = [
      `Input:    ${r.input}`,
      `Id:       ${r.id || '(empty after normalization)'}`,
      `Filename: ${r.filename}`,
      `Exists:   ${r.exists ? 'yes' : 'no'}`,
    ]
    if (r.title) lines.push(`Title:    ${r.title}`)
    if (r.category) lines.push(`Category: ${r.category}`)
    if (!r.exists && r.suggestions.length > 0) {
      lines.push('')
      lines.push('Did you mean:')
      for (const s of r.suggestions) lines.push(`  - ${s}`)
    }
    return lines.join('\n')
  }
}
