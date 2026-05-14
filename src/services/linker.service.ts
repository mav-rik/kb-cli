import { StorageService } from './storage.service.js'
import { ParserService } from './parser.service.js'
import { IndexService } from './index.service.js'
import { toDocId, toFilename } from '../utils/slug.js'

export class LinkerService {
  constructor(
    private storage: StorageService,
    private parser: ParserService,
    private index: IndexService,
  ) {}

  async updateLinksAcrossKb(kb: string, oldFilename: string, newFilename: string): Promise<number> {
    const files = this.storage.listFiles(kb)
    let modifiedCount = 0

    const escapedOld = oldFilename.replace(/\./g, '\\.')
    const pattern = new RegExp(`\\]\\(\\.\\/` + escapedOld + `\\)`, 'g')

    for (const file of files) {
      const raw = this.storage.readRaw(kb, file)
      const replaced = raw.replace(pattern, `](./${newFilename})`)
      if (replaced !== raw) {
        const parsed = this.parser.parse(replaced)
        this.storage.writeDoc(kb, file, parsed.frontmatter, parsed.body)
        modifiedCount++
      }
    }

    return modifiedCount
  }

  findBrokenLinks(kb: string): { fromFile: string; linkText: string; targetFile: string }[] {
    const files = this.storage.listFiles(kb)
    const broken: { fromFile: string; linkText: string; targetFile: string }[] = []

    for (const file of files) {
      const doc = this.storage.readDoc(kb, file)
      for (const link of doc.links) {
        if (!this.storage.docExists(kb, link.target)) {
          broken.push({
            fromFile: file,
            linkText: link.text,
            targetFile: link.target,
          })
        }
      }
    }

    return broken
  }

  async findOrphans(kb: string): Promise<string[]> {
    const files = this.storage.listFiles(kb)
    const orphans: string[] = []

    for (const file of files) {
      const id = toDocId(file)
      const incomingLinks = await this.index.getLinksTo(kb, id)
      if (incomingLinks.length === 0) {
        orphans.push(file)
      }
    }

    return orphans
  }

  async getBacklinks(kb: string, filename: string): Promise<string[]> {
    const id = toDocId(filename)
    const incomingLinks = await this.index.getLinksTo(kb, id)
    return incomingLinks.map((link) => toFilename(link.fromId))
  }
}
