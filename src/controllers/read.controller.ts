import { Controller, Cli, Param, CliOption, Description, Optional } from '@moostjs/event-cli'
import { services } from '../services/container.js'
import { toFilename, parseLineRange } from '../utils/slug.js'

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
    @Description('Show metadata only') @CliOption('meta', 'm') meta: boolean,
    @Description('List outgoing links') @CliOption('links') links: boolean,
    @Description('Follow a link') @CliOption('follow', 'f') @Optional() follow: string,
    @Description('Wiki') @CliOption('wiki', 'w') @Optional() wiki: string,
  ): Promise<string | object> {
    const ref = this.config.resolveWiki(wiki)
    const ops = this.gateway.getOps(ref)
    const targetPath = toFilename(follow ? follow.replace(/^\.\//, '') : docPath)

    if (!await ops.docExists(targetPath)) {
      return `Error: Document "${targetPath}" not found.`
    }

    const doc = await ops.readDoc(targetPath)

    if (meta) {
      return doc.frontmatter
    }

    if (links) {
      if (doc.links.length === 0) {
        return 'No outgoing links.'
      }
      return doc.links.map((l) => `${l.text} -> ./${l.target}`).join('\n')
    }

    const bodyLines = doc.body.split('\n')
    const totalLines = bodyLines.length

    let start = 1
    let end = totalLines
    if (lines) {
      ({ start, end } = parseLineRange(lines, totalLines))
    }

    const selectedLines = bodyLines.slice(start - 1, end)

    const header = [`=== ${targetPath} (lines ${start}-${end} of ${totalLines}) ===`]
    if (doc.frontmatter.tags.length > 0) {
      header.push(`Tags: ${doc.frontmatter.tags.join(', ')}`)
    }
    if (doc.links.length > 0) {
      header.push(`Links: ${doc.links.map((l) => `./${l.target}`).join(', ')}`)
    }
    header.push('---')

    const padWidth = String(end).length
    const numbered = selectedLines.map(
      (line, i) => `${String(start + i).padStart(padWidth)} | ${line}`,
    )

    return [...header, ...numbered].join('\n')
  }
}
