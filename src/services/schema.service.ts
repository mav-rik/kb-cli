import * as fs from 'node:fs'
import * as path from 'node:path'
import { ConfigService } from './config.service.js'
import { IndexService } from './index.service.js'
import { StorageService } from './storage.service.js'

export class SchemaService {
  constructor(
    private config: ConfigService,
    private index: IndexService,
    private storage: StorageService,
  ) {}

  private getSchemaPath(kb: string): string {
    return path.join(this.config.getDataDir(), kb, 'schema.md')
  }

  read(kb: string): string | null {
    const schemaPath = this.getSchemaPath(kb)
    if (!fs.existsSync(schemaPath)) return null
    return fs.readFileSync(schemaPath, 'utf-8')
  }

  async update(kb: string): Promise<string> {
    const docs = await this.index.listDocs(kb)
    const files = this.storage.listFiles(kb)

    // Preserve user-editable section from existing schema
    const existingSchema = this.read(kb)
    const customSection = this.extractCustomSection(existingSchema)

    // Gather categories with counts
    const categories: Record<string, number> = {}
    for (const doc of docs) {
      const cat = doc.category || 'uncategorized'
      categories[cat] = (categories[cat] || 0) + 1
    }

    // Gather all tags with frequency
    const tagFreq: Record<string, number> = {}
    for (const doc of docs) {
      const tags = Array.isArray(doc.tags) ? doc.tags : []
      for (const tag of tags) {
        tagFreq[tag] = (tagFreq[tag] || 0) + 1
      }
    }
    const topTags = Object.entries(tagFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)

    // Count links
    let totalLinks = 0
    for (const file of files) {
      try {
        const parsed = this.storage.readDoc(kb, file)
        totalLinks += parsed.links.length
      } catch {}
    }

    // Build schema content
    const lines: string[] = []
    lines.push(`# Schema: ${kb}`)
    lines.push('')
    lines.push(`> Auto-generated sections are rebuilt by \`aimem schema update\`.`)
    lines.push(`> The "Custom" section at the bottom is preserved across updates — edit it freely.`)
    lines.push('')
    lines.push(`## Stats`)
    lines.push('')
    lines.push(`- Documents: ${docs.length}`)
    lines.push(`- Categories: ${Object.keys(categories).length}`)
    lines.push(`- Cross-links: ${totalLinks}`)
    lines.push(`- Updated: ${new Date().toISOString().split('T')[0]}`)
    lines.push('')
    lines.push(`## Categories`)
    lines.push('')
    const sortedCats = Object.entries(categories).sort((a, b) => b[1] - a[1])
    for (const [cat, count] of sortedCats) {
      lines.push(`- **${cat}** (${count} docs)`)
    }
    lines.push('')
    lines.push(`## Top Tags`)
    lines.push('')
    if (topTags.length > 0) {
      lines.push(topTags.map(([tag, count]) => `\`${tag}\` (${count})`).join(', '))
    } else {
      lines.push('No tags in use.')
    }
    lines.push('')
    lines.push(`## Conventions`)
    lines.push('')
    lines.push(`- File naming: slug derived from title (lowercase, hyphens)`)
    lines.push(`- Links: standard Markdown \`[text](./filename.md)\``)
    lines.push(`- Frontmatter: id, title, category, tags, created, updated`)
    lines.push(`- One concept per document, 50-200 lines target`)
    lines.push('')
    lines.push(`## Document Index`)
    lines.push('')
    for (const [cat] of sortedCats) {
      const catDocs = docs.filter(d => d.category === cat).sort((a, b) => a.title.localeCompare(b.title))
      lines.push(`### ${cat}`)
      for (const doc of catDocs) {
        lines.push(`- [${doc.title}](./docs/${doc.id}.md)`)
      }
      lines.push('')
    }

    // Append preserved custom section
    lines.push(`## Custom`)
    lines.push('')
    if (customSection) {
      lines.push(customSection)
    } else {
      lines.push(`<!-- Add domain-specific conventions, rules, or notes below. This section survives schema updates. -->`)
      lines.push('')
    }

    const content = lines.join('\n')
    fs.writeFileSync(this.getSchemaPath(kb), content, 'utf-8')
    return content
  }

  private extractCustomSection(schema: string | null): string | null {
    if (!schema) return null
    const marker = '## Custom'
    const idx = schema.indexOf(marker)
    if (idx === -1) return null
    const afterMarker = schema.slice(idx + marker.length).replace(/^\n+/, '')
    return afterMarker.trim() || null
  }
}
