import { createHash } from 'node:crypto'

/**
 * Compute a SHA-256 hex digest of the given content string.
 */
export function contentHash(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex')
}
