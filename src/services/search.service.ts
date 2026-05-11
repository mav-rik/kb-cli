import { EmbeddingService } from './embedding.service.js'
import { VectorService } from './vector.service.js'
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
    private index: IndexService,
    private storage: StorageService,
  ) {}

  /**
   * Hybrid search: combines semantic (vector KNN) + keyword (FTS5) results
   * using Reciprocal Rank Fusion.
   */
  async search(kb: string, query: string, limit: number = 10): Promise<SearchResult[]> {
    // 1. Compute query embedding
    const queryVec = await this.embedding.embed(query)

    // 2. Run both searches
    const semanticResults = this.vector.searchVec(kb, queryVec, limit * 2)
    const keywordResults = await this.index.searchFts(kb, query, limit * 2)

    // 3. Merge via Reciprocal Rank Fusion (k=60)
    const k = 60
    const scores = new Map<string, number>()

    for (let i = 0; i < semanticResults.length; i++) {
      const id = semanticResults[i].id
      const rank = i + 1 // 1-based
      scores.set(id, (scores.get(id) || 0) + 1 / (k + rank))
    }

    for (let i = 0; i < keywordResults.length; i++) {
      const id = keywordResults[i].id
      const rank = i + 1 // 1-based
      scores.set(id, (scores.get(id) || 0) + 1 / (k + rank))
    }

    // 4. Sort by RRF score descending
    const merged = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)

    // 5. Fetch metadata and generate snippets
    const results: SearchResult[] = []
    for (const [id, score] of merged) {
      const doc = await this.index.getDoc(kb, id)
      if (!doc) continue

      const filename = doc.filePath || `${id}.md`
      let body = ''
      try {
        const parsed = this.storage.readDoc(kb, filename)
        body = parsed.body
      } catch {
        // File might not exist on disk
      }

      const snippet = this.generateSnippet(body, query)

      results.push({
        id,
        title: doc.title,
        category: doc.category,
        score,
        snippet,
        filename,
      })
    }

    return results
  }

  /**
   * Generate a snippet from body content, centered around the first query term match.
   * Falls back to the first 150 characters if no match is found.
   */
  private generateSnippet(body: string, query: string): string {
    if (!body) return ''

    const snippetLen = 150
    const lowerBody = body.toLowerCase()
    const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2)

    // Try to find the first matching query word in the body
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
      // Center the snippet around the match
      const start = Math.max(0, matchIndex - Math.floor(snippetLen / 2))
      const end = Math.min(body.length, start + snippetLen)
      raw = body.slice(start, end)
    } else {
      // Use the first 150 chars
      raw = body.slice(0, snippetLen)
    }

    // Trim to word boundaries
    raw = raw.trim()
    if (raw.length < body.length) {
      // Trim trailing partial word
      const lastSpace = raw.lastIndexOf(' ')
      if (lastSpace > raw.length - 20 && lastSpace > 0) {
        raw = raw.slice(0, lastSpace)
      }
      raw += '...'
    }

    // Remove newlines for clean display
    raw = raw.replace(/\n+/g, ' ').replace(/\s+/g, ' ')

    return raw
  }
}
