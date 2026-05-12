import type { SearchMode } from './search.service.js'

export class RemoteError extends Error {
  constructor(public status: number, message: string, public url: string) {
    super(`Remote error (${status}): ${message}`)
  }
}

export class RemoteClient {
  private async request(url: string, path: string, pat?: string, options?: RequestInit): Promise<any> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (pat) headers['Authorization'] = `Bearer ${pat}`

    const fullUrl = `${url.replace(/\/$/, '')}/api${path}`
    const res = await fetch(fullUrl, { ...options, headers: { ...headers, ...options?.headers } })

    if (!res.ok) {
      let message = res.statusText
      try {
        const body = await res.json()
        if (body.error) message = body.error
      } catch {}
      throw new RemoteError(res.status, message, fullUrl)
    }

    const contentType = res.headers.get('content-type') || ''
    if (contentType.includes('application/json')) return res.json()
    return res.text()
  }

  private get(url: string, path: string, pat?: string) {
    return this.request(url, path, pat)
  }

  private post(url: string, path: string, body: any, pat?: string) {
    return this.request(url, path, pat, { method: 'POST', body: JSON.stringify(body) })
  }

  private put(url: string, path: string, body: any, pat?: string) {
    return this.request(url, path, pat, { method: 'PUT', body: JSON.stringify(body) })
  }

  private del(url: string, path: string, pat?: string) {
    return this.request(url, path, pat, { method: 'DELETE' })
  }

  async health(url: string, pat?: string): Promise<{ status: string }> {
    return this.get(url, '/health', pat)
  }

  async listWikis(url: string, pat?: string): Promise<string[]> {
    return this.get(url, '/wiki', pat)
  }

  async search(url: string, wiki: string, query: string, limit: number, mode: SearchMode, pat?: string) {
    const params = new URLSearchParams({ q: query, limit: String(limit), mode, wiki })
    return this.get(url, `/search?${params}`, pat)
  }

  async read(url: string, wiki: string, filename: string, opts?: { lines?: string; format?: string; meta?: string; links?: string }, pat?: string) {
    const params = new URLSearchParams({ wiki })
    if (opts?.lines) params.set('lines', opts.lines)
    if (opts?.format) params.set('format', opts.format)
    if (opts?.meta) params.set('meta', opts.meta)
    if (opts?.links) params.set('links', opts.links)
    return this.get(url, `/read/${encodeURIComponent(filename)}?${params}`, pat)
  }

  async addDoc(url: string, wiki: string, doc: { title: string; category: string; tags?: string[]; content?: string }, pat?: string) {
    return this.post(url, '/docs', { ...doc, wiki }, pat)
  }

  async updateDoc(url: string, wiki: string, id: string, patch: { title?: string; category?: string; tags?: string[]; content?: string; append?: string }, pat?: string) {
    return this.put(url, `/docs/${encodeURIComponent(id)}`, { ...patch, wiki }, pat)
  }

  async deleteDoc(url: string, wiki: string, id: string, pat?: string) {
    const params = new URLSearchParams({ wiki })
    return this.del(url, `/docs/${encodeURIComponent(id)}?${params}`, pat)
  }

  async listDocs(url: string, wiki: string, filters?: { category?: string; tag?: string }, pat?: string) {
    const params = new URLSearchParams({ wiki })
    if (filters?.category) params.set('category', filters.category)
    if (filters?.tag) params.set('tag', filters.tag)
    return this.get(url, `/docs?${params}`, pat)
  }

  async related(url: string, wiki: string, id: string, limit?: number, pat?: string) {
    const params = new URLSearchParams({ wiki })
    if (limit) params.set('limit', String(limit))
    return this.get(url, `/related/${encodeURIComponent(id)}?${params}`, pat)
  }

  async rename(url: string, wiki: string, id: string, newId: string, pat?: string) {
    return this.post(url, `/docs/${encodeURIComponent(id)}/rename`, { to: newId, wiki }, pat)
  }

  async lint(url: string, wiki: string, pat?: string) {
    const params = new URLSearchParams({ wiki })
    return this.get(url, `/lint?${params}`, pat)
  }

  async lintFix(url: string, wiki: string, pat?: string) {
    const params = new URLSearchParams({ wiki })
    return this.post(url, `/lint/fix?${params}`, {}, pat)
  }

  async reindex(url: string, wiki: string, pat?: string) {
    const params = new URLSearchParams({ wiki })
    return this.post(url, `/reindex?${params}`, {}, pat)
  }

  async categories(url: string, wiki: string, pat?: string) {
    const params = new URLSearchParams({ wiki })
    return this.get(url, `/categories?${params}`, pat)
  }

  async toc(url: string, wiki: string, pat?: string) {
    const params = new URLSearchParams({ wiki })
    return this.get(url, `/toc?${params}`, pat)
  }

  async log(url: string, wiki: string, limit?: number, pat?: string) {
    const params = new URLSearchParams({ wiki })
    if (limit) params.set('limit', String(limit))
    return this.get(url, `/log?${params}`, pat)
  }

  async logAdd(url: string, wiki: string, op: string, doc?: string, details?: string, pat?: string) {
    return this.post(url, '/log', { wiki, op, doc, details }, pat)
  }

  async schema(url: string, wiki: string, pat?: string) {
    const params = new URLSearchParams({ wiki })
    return this.get(url, `/schema?${params}`, pat)
  }

  async schemaUpdate(url: string, wiki: string, pat?: string) {
    const params = new URLSearchParams({ wiki })
    return this.post(url, `/schema?${params}`, {}, pat)
  }

  async createWiki(url: string, name: string, pat?: string) {
    return this.post(url, '/wiki', { name }, pat)
  }

  async deleteWiki(url: string, name: string, pat?: string) {
    return this.del(url, `/wiki/${encodeURIComponent(name)}`, pat)
  }
}
