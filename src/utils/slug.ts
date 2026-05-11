/**
 * Convert a title string to a filename-safe slug.
 *
 * - Lowercase
 * - Replace spaces and special characters with hyphens
 * - Remove consecutive hyphens
 * - Trim leading/trailing hyphens
 *
 * Examples:
 *   "API Redesign Project" → "api-redesign-project"
 *   "Hello, World!" → "hello-world"
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function toFilename(id: string): string {
  return id.endsWith('.md') ? id : `${id}.md`
}

export function toDocId(filename: string): string {
  return filename.replace(/\.md$/, '')
}

export function today(): string {
  return new Date().toISOString().split('T')[0]
}

/**
 * Parse a line range string like "5-20" against a total line count.
 * Returns clamped 1-based start/end values.
 */
export function parseLineRange(text: string, totalLines: number): { start: number; end: number } {
  const parts = text.split('-')
  const start = Math.max(1, parseInt(parts[0], 10) || 1)
  const end = Math.min(totalLines, parseInt(parts[1], 10) || totalLines)
  return { start, end }
}
