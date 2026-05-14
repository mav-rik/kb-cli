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

/**
 * Resolve any accepted doc handle (id, `.md` form, `./` prefix, full path)
 * into the canonical `{ id, filename }` pair. Used at every public boundary
 * so internal code only ever sees the canonical form.
 */
export function canonicalize(input: string): { id: string; filename: string } {
  const id = normalizeDocId(input)
  return { id, filename: toFilename(id) }
}

/**
 * Canonical id form. Agents pass ids in many shapes — bare slug, `.md`
 * suffix (case varies), `./` prefix from a markdown link, full disk path,
 * surrounding whitespace. This collapses every accepted form into the bare
 * id (no extension, no path prefix) used as the index primary key.
 *
 * Called at every public boundary that accepts an id from outside (CLI
 * params, HTTP body/path, link target). Once normalized, internal code
 * works with one canonical form — no more divergent index rows where
 * `foo` and `foo.md` exist side-by-side.
 */
export function normalizeDocId(input: string): string {
  let s = String(input ?? '').trim()
  if (s.startsWith('./')) s = s.slice(2)
  // Take the basename — strips any directory prefix the agent might pass
  // (e.g. "/Users/.../docs/foo.md" or "docs/foo.md").
  const lastSep = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
  if (lastSep >= 0) s = s.slice(lastSep + 1)
  // Strip a trailing `.md`/`.MD`/etc. — case-insensitive so we don't choke
  // on filesystems / shells that uppercase extensions.
  if (s.toLowerCase().endsWith('.md')) s = s.slice(0, -3)
  // Lowercase: `slugify` always emits lowercase ids, so the canonical form
  // is lowercase. Without this, on case-insensitive filesystems (macOS,
  // Windows) `kb update FOO.MD` would resolve to the existing `foo.md`
  // file but plant a second index row with id="FOO".
  return s.toLowerCase()
}

export function today(): string {
  return new Date().toISOString().split('T')[0]
}

/**
 * Parse a line range string like "5-20". Returns 1-based start/end.
 * Missing end -> Infinity (let the consumer clamp to the file length).
 * Optional `context` expands the range by N lines on each side.
 */
export function parseLineRange(text: string, context: number = 0): { start: number; end: number } {
  if (!text) {
    return { start: 1, end: Infinity }
  }
  const parts = text.split('-')
  let start = parseInt(parts[0], 10) || 1
  let end = parseInt(parts[1], 10) || Infinity
  if (context > 0) {
    start -= context
    end = end === Infinity ? Infinity : end + context
  }
  return { start: Math.max(1, start), end }
}
