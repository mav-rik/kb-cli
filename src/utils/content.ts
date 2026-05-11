import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const contentDir = path.resolve(__dirname, '..', 'content')

/**
 * Read a file from the bundled content directory.
 * Returns the file contents or an error string if not found.
 */
export function readContent(name: string): string {
  const filePath = path.join(contentDir, name)
  if (!fs.existsSync(filePath)) {
    return `Error: Content file "${name}" not found at ${filePath}.`
  }
  return fs.readFileSync(filePath, 'utf-8')
}
