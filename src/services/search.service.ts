import { EmbeddingService } from './embedding.service.js'
import { VectorService } from './vector.service.js'
import { FtsService } from './fts.service.js'
import { IndexService } from './index.service.js'
import { StorageService } from './storage.service.js'

export interface SearchResult {
  id: string
  title: string
  category: string
  score: number
  snippet: string
  filename: string
}

export class SearchService {
  constructor(
    private embedding: EmbeddingService,
    private vector: VectorService,
    private fts: FtsService,
    private index: IndexService,
    private storage: StorageService,
  ) {}

  async search(kb: string, query: string, limit: number = 10): Promise<SearchResult[]> {
    const queryVec = await this.embedding.embed(query)

    const semanticResults = this.vector.searchVec(kb, queryVec, limit * 2)
    const keywordResults = this.fts.search(kb, query, limit * 2)

    // Merge via Reciprocal Rank Fusion (k=60)
    const k = 60
    const scores = new Map<string, number>()

    for (let i = 0; i < semanticResults.length; i++) {
      const id = semanticResults[i].id
      const rank = i + 1
      scores.set(id, (scores.get(id) || 0) + 1 / (k + rank))
    }

    for (let i = 0; i < keywordResults.length; i++) {
      const id = keywordResults[i].id
      const rank = i + 1
      scores.set(id, (scores.get(id) || 0) + 1 / (k + rank))
    }

    const merged = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)

    return this.buildResults(kb, merged, query)
  }

  async buildResults(kb: string, scored: [string, number][], query: string = ''): Promise<SearchResult[]> {
    const results: SearchResult[] = []
    for (const [id, score] of scored) {
      const doc = await this.index.getDoc(kb, id)
      if (!doc) continue

      const filename = doc.filePath || `${id}.md`
      let body = ''
      try {
        const parsed = this.storage.readDoc(kb, filename)
        body = parsed.body
      } catch {}

      results.push({
        id,
        title: doc.title,
        category: doc.category,
        score,
        snippet: this.generateSnippet(body, query),
        filename,
      })
    }

    return results
  }

  private generateSnippet(body: string, query: string): string {
    if (!body) return ''

    const snippetLen = 150
    const lowerBody = body.toLowerCase()
    const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2)

    let matchIndex = -1
    for (const word of queryWords) {
      const idx = lowerBody.indexOf(word)
      if (idx !== -1) {
        matchIndex = idx
        break
      }
    }

    let raw: string
    if (matchIndex !== -1) {
      const start = Math.max(0, matchIndex - Math.floor(snippetLen / 2))
      const end = Math.min(body.length, start + snippetLen)
      raw = body.slice(start, end)
    } else {
      raw = body.slice(0, snippetLen)
    }

    raw = raw.trim()
    if (raw.length < body.length) {
      const lastSpace = raw.lastIndexOf(' ')
      if (lastSpace > raw.length - 20 && lastSpace > 0) {
        raw = raw.slice(0, lastSpace)
      }
      raw += '...'
    }

    raw = raw.replace(/\n+/g, ' ').replace(/\s+/g, ' ')
    return raw
  }
}
