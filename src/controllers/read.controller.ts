import { Controller, Cli, Param, CliOption, Description, Optional } from '@moostjs/event-cli'
import { services } from '../services/container.js'
import { toFilename } from '../utils/slug.js'

@Controller('read')
export class ReadController {
  private get config() { return services.config }
  private get storage() { return services.storage }

  @Cli(':path')
  @Description('Read a document')
  read(
    @Param('path') docPath: string,
    @Description('Line range (e.g., 1-50)') @CliOption('lines', 'l') @Optional() lines: string,
    @Description('Show metadata only') @CliOption('meta', 'm') meta: boolean,
    @Description('List outgoing links') @CliOption('links') links: boolean,
    @Description('Follow a link') @CliOption('follow', 'f') @Optional() follow: string,
    @Description('Wiki') @CliOption('wiki', 'w') @Optional() wiki: string,
  ) {
    const kbName = this.config.resolveWiki(wiki)
    const targetPath = toFilename(follow ? follow.replace(/^\.\//, '') : docPath)

    if (!this.storage.docExists(kbName, targetPath)) {
      return `Error: Document "${targetPath}" not found in wiki "${kbName}".`
    }

    const doc = this.storage.readDoc(kbName, targetPath)

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
      const parts = lines.split('-')
      start = Math.max(1, parseInt(parts[0], 10) || 1)
      end = Math.min(totalLines, parseInt(parts[1], 10) || totalLines)
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
