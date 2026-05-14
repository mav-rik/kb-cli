import type { SearchMode } from './search.service.js'

export class RemoteError extends Error {
  constructor(
    public status: number,
    message: string,
    public url: string,
    public body?: Record<string, unknown>,
  ) {
    super(message)
  }
}

export class RemoteClient {
  private async request(url: string, path: string, secret?: string, options?: RequestInit): Promise<any> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (secret) headers['Authorization'] = `Bearer ${secret}`

    const fullUrl = `${url.replace(/\/$/, '')}/api${path}`
    const res = await fetch(fullUrl, { ...options, headers: { ...headers, ...options?.headers } })

    if (!res.ok) {
      let message = res.statusText
      let body: Record<string, unknown> | undefined
      try {
        body = await res.json()
        // Prefer the custom message — `error` is the generic HTTP status text
        // (e.g. "Not Found") when our HttpError(code, {...}) body is used;
        // `message` carries our actual text. Older string-body errors set
        // `error` to the message — fall back to that, then to statusText.
        const m = body && typeof body === 'object' ? body : {}
        message =
          (typeof m.message === 'string' && m.message) ||
          (typeof m.error === 'string' && m.error) ||
          res.statusText
      } catch {}
      throw new RemoteError(res.status, message, fullUrl, body)
    }

    const contentType = res.headers.get('content-type') || ''
    if (contentType.includes('application/json')) return res.json()
    return res.text()
  }

  private get(url: string, path: string, secret?: string) {
    return this.request(url, path, secret)
  }

  private post(url: string, path: string, body: any, secret?: string) {
    return this.request(url, path, secret, { method: 'POST', body: JSON.stringify(body) })
  }

  private put(url: string, path: string, body: any, secret?: string) {
    return this.request(url, path, secret, { method: 'PUT', body: JSON.stringify(body) })
  }

  private del(url: string, path: string, secret?: string) {
    return this.request(url, path, secret, { method: 'DELETE' })
  }

  async health(url: string, secret?: string): Promise<{ status: string }> {
    return this.get(url, '/health', secret)
  }

  async listWikis(url: string, secret?: string): Promise<string[]> {
    return this.get(url, '/wiki', secret)
  }

  async wikiInfo(url: string, name: string, secret?: string): Promise<{ name: string; docCount: number; sizeBytes: number; lastUpdated: string | null }> {
    return this.get(url, `/wiki/${encodeURIComponent(name)}`, secret)
  }

  async skill(url: string, workflow?: string, secret?: string): Promise<string | { error: string }> {
    const params = new URLSearchParams()
    if (workflow) params.set('workflow', workflow)
    const qs = params.toString()
    return this.get(url, `/skill${qs ? `?${qs}` : ''}`, secret)
  }

  async search(url: string, wiki: string, query: string, limit: number, mode: SearchMode, secret?: string) {
    const params = new URLSearchParams({ q: query, limit: String(limit), mode, wiki })
    return this.get(url, `/search?${params}`, secret)
  }

  async read(url: string, wiki: string, filename: string, opts?: { lines?: string; format?: string; meta?: string; links?: string }, secret?: string) {
    const params = new URLSearchParams({ wiki })
    if (opts?.lines) params.set('lines', opts.lines)
    if (opts?.format) params.set('format', opts.format)
    if (opts?.meta) params.set('meta', opts.meta)
    if (opts?.links) params.set('links', opts.links)
    return this.get(url, `/read/${encodeURIComponent(filename)}?${params}`, secret)
  }

  async resolve(url: string, wiki: string, input: string, secret?: string) {
    const params = new URLSearchParams({ wiki })
    return this.get(url, `/resolve/${encodeURIComponent(input)}?${params}`, secret)
  }

  async readSlice(url: string, wiki: string, filename: string, fromLine: number, toLine: number, secret?: string) {
    const params = new URLSearchParams({ wiki, from: String(fromLine), to: String(toLine) })
    return this.get(url, `/read-slice/${encodeURIComponent(filename)}?${params}`, secret)
  }

  async addDoc(url: string, wiki: string, doc: { title: string; category: string; tags?: string[]; content?: string; dryRun?: boolean }, secret?: string) {
    return this.post(url, '/docs', { ...doc, wiki }, secret)
  }

  async updateDoc(url: string, wiki: string, id: string, patch: { title?: string; category?: string; tags?: string[]; content?: string; append?: string; dryRun?: boolean }, secret?: string) {
    return this.put(url, `/docs/${encodeURIComponent(id)}`, { ...patch, wiki }, secret)
  }

  async deleteDoc(url: string, wiki: string, id: string, secret?: string) {
    const params = new URLSearchParams({ wiki })
    return this.del(url, `/docs/${encodeURIComponent(id)}?${params}`, secret)
  }

  async listDocs(url: string, wiki: string, filters?: { category?: string; tag?: string }, secret?: string) {
    const params = new URLSearchParams({ wiki })
    if (filters?.category) params.set('category', filters.category)
    if (filters?.tag) params.set('tag', filters.tag)
    return this.get(url, `/docs?${params}`, secret)
  }

  async related(url: string, wiki: string, id: string, limit?: number, secret?: string) {
    const params = new URLSearchParams({ wiki })
    if (limit) params.set('limit', String(limit))
    return this.get(url, `/related/${encodeURIComponent(id)}?${params}`, secret)
  }

  async rename(url: string, wiki: string, id: string, newId: string, secret?: string) {
    return this.post(url, `/docs/${encodeURIComponent(id)}/rename`, { to: newId, wiki }, secret)
  }

  async lint(url: string, wiki: string, secret?: string) {
    const params = new URLSearchParams({ wiki })
    return this.get(url, `/lint?${params}`, secret)
  }

  async lintFix(url: string, wiki: string, secret?: string) {
    const params = new URLSearchParams({ wiki })
    return this.post(url, `/lint/fix?${params}`, {}, secret)
  }

  async reindex(url: string, wiki: string, secret?: string) {
    const params = new URLSearchParams({ wiki })
    return this.post(url, `/reindex?${params}`, {}, secret)
  }

  async reindexDoc(url: string, wiki: string, id: string, secret?: string) {
    const params = new URLSearchParams({ wiki })
    return this.post(url, `/reindex/${encodeURIComponent(id)}?${params}`, {}, secret)
  }

  async categories(url: string, wiki: string, secret?: string) {
    const params = new URLSearchParams({ wiki })
    return this.get(url, `/categories?${params}`, secret)
  }

  async toc(url: string, wiki: string, secret?: string) {
    const params = new URLSearchParams({ wiki })
    return this.get(url, `/toc?${params}`, secret)
  }

  async log(url: string, wiki: string, limit?: number, secret?: string) {
    const params = new URLSearchParams({ wiki })
    if (limit) params.set('limit', String(limit))
    return this.get(url, `/log?${params}`, secret)
  }

  async logAdd(url: string, wiki: string, op: string, doc?: string, details?: string, secret?: string) {
    return this.post(url, '/log', { wiki, op, doc, details }, secret)
  }

  async schema(url: string, wiki: string, secret?: string) {
    const params = new URLSearchParams({ wiki })
    return this.get(url, `/schema?${params}`, secret)
  }

  async schemaUpdate(url: string, wiki: string, secret?: string) {
    const params = new URLSearchParams({ wiki })
    return this.post(url, `/schema?${params}`, {}, secret)
  }

  async createWiki(url: string, name: string, secret?: string) {
    return this.post(url, '/wiki', { name }, secret)
  }

  async deleteWiki(url: string, name: string, secret?: string) {
    return this.del(url, `/wiki/${encodeURIComponent(name)}`, secret)
  }
}
