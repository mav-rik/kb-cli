import { ChunkFtsService } from './chunk-fts.service.js'
import { EmbeddingService } from './embedding.service.js'
import { IndexService } from './index.service.js'
import { StorageService } from './storage.service.js'

export type SearchMode = 'hybrid' | 'fts' | 'vec'

export interface SearchResult {
  filename: string
  title: string
  category: string
  heading?: string
  headingPath?: string
  lines: [number, number]
  score: number
  snippet: string
}

export interface RelatedResult {
  filename: string
  title: string
  category: string
  score: number
  snippet: string
}

const SNIPPET_LEN = 150
const PER_DOC_CAP = 2
const RRF_K = 60

export class SearchService {
  constructor(
    private embedding: EmbeddingService,
    private chunkFts: ChunkFtsService,
    private index: IndexService,
    private storage: StorageService,
  ) {}

  async search(kb: string, query: string, limit: number = 10, mode: SearchMode = 'hybrid'): Promise<SearchResult[]> {
    const scores = new Map<string, number>()
    const addRanked = (hits: { id: string }[]) => {
      for (let i = 0; i < hits.length; i++) {
        const id = hits[i].id
        scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + i + 1))
      }
    }

    if (mode !== 'vec') addRanked(this.chunkFts.search(kb, query, limit * 3))
    if (mode !== 'fts') {
      const queryVec = await this.embedding.embed(query)
      addRanked(await this.index.semanticSearchChunks(kb, queryVec, limit * 3))
    }

    if (scores.size === 0) return []

    const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1])
    const chunks = await this.index.listChunksByIds(kb, sorted.map(([id]) => id))
    const chunkMap = new Map(chunks.map((c) => [c.id, c]))

    // Per-doc cap prevents a single doc from dominating the result page.
    const perDoc = new Map<string, number>()
    const results: SearchResult[] = []

    for (const [chunkId, score] of sorted) {
      if (results.length >= limit) break
      const chunk = chunkMap.get(chunkId)
      if (!chunk) continue
      const count = perDoc.get(chunk.docId) ?? 0
      if (count >= PER_DOC_CAP) continue
      perDoc.set(chunk.docId, count + 1)

      const doc = await this.index.getDoc(kb, chunk.docId)
      if (!doc) continue
      const filename = doc.filePath || `${chunk.docId}.md`
      let sliceText = ''
      try {
        sliceText = this.storage.readSlice(kb, filename, chunk.fromLine, chunk.toLine).content
      } catch {}

      results.push({
        filename,
        title: doc.title,
        category: doc.category,
        heading: chunk.heading,
        headingPath: chunk.headingPath,
        lines: [chunk.fromLine, chunk.toLine],
        score,
        snippet: this.generateSnippet(sliceText, query),
      })
    }

    return results
  }

  /**
   * Build whole-document results for `related`. No heading slice — `related`
   * surfaces similar docs, not similar passages.
   */
  async buildRelatedResults(kb: string, scored: [string, number][]): Promise<RelatedResult[]> {
    const results: RelatedResult[] = []
    for (const [id, score] of scored) {
      const doc = await this.index.getDoc(kb, id)
      if (!doc) continue

      const filename = doc.filePath || `${id}.md`
      let snippet = ''
      try {
        snippet = this.generateSnippet(this.storage.readRaw(kb, filename), '')
      } catch {}

      results.push({ filename, title: doc.title, category: doc.category, score, snippet })
    }
    return results
  }

  private generateSnippet(body: string, query: string): string {
    if (!body) return ''

    let start = 0
    const lower = body.toLowerCase()
    for (const word of query.toLowerCase().split(/\s+/)) {
      if (word.length <= 2) continue
      const idx = lower.indexOf(word)
      if (idx !== -1) {
        start = Math.max(0, idx - Math.floor(SNIPPET_LEN / 2))
        break
      }
    }

    const end = Math.min(body.length, start + SNIPPET_LEN)
    let slice = body.slice(start, end).trim()
    const truncated = end < body.length

    if (truncated) {
      const lastSpace = slice.lastIndexOf(' ')
      if (lastSpace > slice.length - 20 && lastSpace > 0) slice = slice.slice(0, lastSpace)
      slice += '...'
    }

    return slice.replace(/\s+/g, ' ')
  }
}
