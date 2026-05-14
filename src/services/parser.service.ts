import matter from 'gray-matter'

export interface DocFrontmatter {
  id: string
  title: string
  category: string
  tags: string[]
  created: string   // ISO date string
  updated: string   // ISO date string
  importantSections?: string[]
  suppressMergeWarn?: string[]
  suppressLint?: string[]
}

export interface DocLink {
  text: string      // display text from [text](./file.md)
  target: string    // filename only (e.g., "api-redesign.md")
}

export interface ParsedDoc {
  frontmatter: DocFrontmatter
  body: string      // markdown body (without frontmatter)
  links: DocLink[]  // extracted links
}

/**
 * Regex to match local markdown links: [text](./filename.md)
 * Only matches links starting with ./ and ending with .md
 */
const LOCAL_LINK_RE = /\[([^\]]+)\]\(\.\/([\w.@-]+\.md)\)/g

export class ParserService {
  /**
   * Parse a full markdown string into frontmatter, body, and links.
   */
  parse(mdContent: string): ParsedDoc {
    const { data, content } = matter(mdContent)
    const frontmatter = this.normalizeFrontmatter(data)
    const body = content.trimStart()
    const links = this.extractLinks(body)
    return { frontmatter, body, links }
  }

  /**
   * Serialize frontmatter and body back into a full markdown string.
   */
  serialize(frontmatter: DocFrontmatter, body: string): string {
    const { importantSections, suppressMergeWarn, suppressLint, ...rest } = frontmatter
    const data: Record<string, unknown> = { ...rest }
    if (importantSections !== undefined) data.important_sections = importantSections
    if (suppressMergeWarn !== undefined) data.suppress_merge_warn = suppressMergeWarn
    if (suppressLint !== undefined) data.suppress_lint = suppressLint
    return matter.stringify(body.startsWith('\n') ? body : `\n${body}`, data)
  }

  /**
   * Extract local markdown links from body text.
   * Only matches [text](./filename.md) patterns.
   */
  extractLinks(body: string): DocLink[] {
    const links: DocLink[] = []
    let match: RegExpExecArray | null
    const re = new RegExp(LOCAL_LINK_RE.source, LOCAL_LINK_RE.flags)
    while ((match = re.exec(body)) !== null) {
      links.push({
        text: match[1],
        target: match[2],
      })
    }
    return links
  }

  /**
   * Ensure frontmatter has all required fields with sensible defaults.
   */
  private normalizeFrontmatter(data: Record<string, unknown>): DocFrontmatter {
    const fm: DocFrontmatter = {
      id: String(data.id ?? ''),
      title: String(data.title ?? ''),
      category: String(data.category ?? ''),
      tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
      created: String(data.created ?? ''),
      updated: String(data.updated ?? ''),
    }
    const important = coerceStringList(data.important_sections)
    if (important) fm.importantSections = important
    const suppress = coerceStringList(data.suppress_merge_warn)
    if (suppress) fm.suppressMergeWarn = suppress
    const suppressLint = coerceStringList(data.suppress_lint)
    if (suppressLint) fm.suppressLint = suppressLint
    return fm
  }
}

function coerceStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out = value.filter((s): s is string => typeof s === 'string' && s.length > 0)
  return out.length > 0 ? out : undefined
}
