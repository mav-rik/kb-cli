import * as fs from 'node:fs'
import * as path from 'node:path'
import { ConfigService } from './config.service.js'
import { ParserService, ParsedDoc, DocFrontmatter } from './parser.service.js'

export class StorageService {
  private config: ConfigService
  private parser: ParserService

  constructor(config: ConfigService, parser: ParserService) {
    this.config = config
    this.parser = parser
  }

  /**
   * Returns the absolute path to <dataDir>/<kb>/docs/
   */
  getDocsDir(kb: string): string {
    return path.join(this.config.getDataDir(), kb, 'docs')
  }

  /**
   * Ensures the docs directory exists for the given KB.
   */
  private ensureDocsDir(kb: string): void {
    const dir = this.getDocsDir(kb)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
  }

  /**
   * Check if a document file exists in the KB.
   */
  docExists(kb: string, filename: string): boolean {
    const filePath = path.join(this.getDocsDir(kb), filename)
    return fs.existsSync(filePath)
  }

  /**
   * Read raw markdown file content (unparsed).
   */
  readRaw(kb: string, filename: string): string {
    const filePath = path.join(this.getDocsDir(kb), filename)
    return fs.readFileSync(filePath, 'utf-8')
  }

  /**
   * Read and parse a document, returning frontmatter, body, and links.
   */
  readDoc(kb: string, filename: string): ParsedDoc {
    const raw = this.readRaw(kb, filename)
    return this.parser.parse(raw)
  }

  /**
   * Write a document with frontmatter and body to disk.
   * Creates the docs directory if it does not exist.
   */
  writeDoc(kb: string, filename: string, frontmatter: DocFrontmatter, body: string): void {
    this.ensureDocsDir(kb)
    const content = this.parser.serialize(frontmatter, body)
    const filePath = path.join(this.getDocsDir(kb), filename)
    fs.writeFileSync(filePath, content, 'utf-8')
  }

  /**
   * Delete a document file from disk.
   */
  deleteDoc(kb: string, filename: string): void {
    const filePath = path.join(this.getDocsDir(kb), filename)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  }

  /**
   * List all .md filenames in the KB's docs directory.
   * Returns an empty array if the directory does not exist.
   */
  listFiles(kb: string): string[] {
    const docsDir = this.getDocsDir(kb)
    if (!fs.existsSync(docsDir)) {
      return []
    }
    return fs.readdirSync(docsDir).filter((f) => f.endsWith('.md')).sort()
  }
}
