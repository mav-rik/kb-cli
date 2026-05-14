import { Controller, Cli, Param, CliOption, Description, Optional } from '@moostjs/event-cli'
import { services } from '../services/container.js'
import { canonicalize, parseLineRange } from '../utils/slug.js'
import { formatDocNotFound } from '../services/wiki-ops.js'
import { WikiName, DocHandle } from '../models/api-bodies.as'

@Controller()
export class ReadController {
  private get config() { return services.config }
  private get gateway() { return services.gateway }

  @Cli('read/:path')
  @Cli('get/:path')
  @Description('Print a document\'s contents (frontmatter + body) with line numbers. Use --lines to read a slice, --meta to skip the body, --links to list outgoing markdown links, or --follow to read another doc by relative link target.')
  async read(
    @Description('Doc handle. Accepts canonical id (`foo`), filename (`foo.md`), or relative path (`./foo.md`). Run `kb resolve <handle>` if you want to see how an input would be canonicalized.') @Param('path') docPath: DocHandle,
    @Description('Line range to read, e.g. `1-50` (inclusive) or `42` (single line). Out-of-range bounds are clamped to the file length.') @CliOption('lines', 'l') @Optional() lines: string,
    @Description('Number of context lines to print before and after the --lines range. Ignored without --lines.') @CliOption('context', 'c') @Optional() context: string,
    @Description('Print only the frontmatter — no body. Mutually useful with --links to inspect metadata without loading content.') @CliOption('meta', 'm') meta: boolean,
    @Description('Print the list of outgoing markdown links found in the body (target → link text), instead of the body itself.') @CliOption('links') links: boolean,
    @Description('Follow a relative link from the doc and read that target instead. Pass the link target (filename or id); kb canonicalizes it.') @CliOption('follow', 'f') @Optional() follow: string,
    @Description('Target wiki name. Defaults to the wiki resolved from `kb.config.json` in the current directory, falling back to the global `defaultWiki`. Run `kb wiki list` to see available wikis.') @CliOption('wiki', 'w') @Optional() wiki: WikiName,
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
  @Description('Diagnostic: show how any input would be canonicalized and whether the resulting doc exists. Reports the canonical id, filename, existence, title/category (if found), and fuzzy suggestions (if not). Use this when `kb read` / `kb update` say "not found" to see exactly what kb interpreted.')
  async resolve(
    @Description('Any accepted form: canonical id (`foo`), filename (`foo.md`), relative path (`./foo.md`), or full disk path. kb normalizes it and reports the result.') @Param('input') input: DocHandle,
    @Description('Output format. Default: human-readable text with optional "Did you mean:" suggestions. Use --format json for the structured `{ input, id, filename, exists, title?, category?, suggestions[] }` object.') @CliOption('format') @Optional() format: string,
    @Description('Target wiki name. Defaults to the wiki resolved from `kb.config.json` in the current directory, falling back to the global `defaultWiki`. Run `kb wiki list` to see available wikis.') @CliOption('wiki', 'w') @Optional() wiki: WikiName,
  ): Promise<string | object> {
    const ref = this.config.resolveWiki(wiki)
    const ops = this.gateway.getOps(ref)
    const r = await ops.resolve(input)

    if (format === 'json') return r

    // When the doc exists, the id/filename describe the resolved target.
    // When it doesn't, they're only the canonicalization of the input — say
    // so explicitly to avoid reading like "here's the doc."
    const lines: string[] = [`Input:    ${r.input}`]
    if (r.exists) {
      lines.push(
        `Id:       ${r.id}`,
        `Filename: ${r.filename}`,
        `Exists:   yes`,
      )
      if (r.title) lines.push(`Title:    ${r.title}`)
      if (r.category) lines.push(`Category: ${r.category}`)
    } else {
      const candidateId = r.id || '(empty after normalization)'
      lines.push(
        `Exists:   no`,
        `Would normalize to:`,
        `  Id:       ${candidateId}`,
        `  Filename: ${r.filename}`,
      )
      if (r.suggestions.length > 0) {
        lines.push('')
        lines.push('Did you mean:')
        for (const s of r.suggestions) lines.push(`  - ${s}`)
      }
    }
    return lines.join('\n')
  }
}
