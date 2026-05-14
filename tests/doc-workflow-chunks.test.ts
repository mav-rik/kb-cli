import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-docworkflow-chunks-'))

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: () => tmpDir }
})

const { ConfigService } = await import('../src/services/config.service.js')
const { IndexService } = await import('../src/services/index.service.js')
const { EmbeddingService } = await import('../src/services/embedding.service.js')
const { StorageService } = await import('../src/services/storage.service.js')
const { ParserService } = await import('../src/services/parser.service.js')
const { LinkerService } = await import('../src/services/linker.service.js')
const { ChunkerService } = await import('../src/services/chunker.service.js')
const { ChunkFtsService } = await import('../src/services/chunk-fts.service.js')
const { DocWorkflowService } = await import('../src/services/doc-workflow.service.js')

const kbDir = path.join(tmpDir, '.kb')

function freshKbDir() {
  if (fs.existsSync(kbDir)) fs.rmSync(kbDir, { recursive: true, force: true })
  fs.mkdirSync(kbDir, { recursive: true })
}

function hashedVec(text: string): Float32Array {
  const v = new Float32Array(768)
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0
  v[Math.abs(h) % 768] = 1
  return v
}

function buildServices() {
  const config = new ConfigService()
  const parser = new ParserService()
  const storage = new StorageService(config, parser)
  const index = new IndexService(config)
  const embedding = new EmbeddingService(config)
  const linker = new LinkerService(storage, parser, index)
  const chunker = new ChunkerService()
  const chunkFts = new ChunkFtsService(config)

  const embedBatchSpy = vi.fn(async (texts: string[]) => texts.map((t) => hashedVec(t)))
  const embedSpy = vi.fn(async (t: string) => hashedVec(t))
  embedding.embedBatch = embedBatchSpy
  embedding.embed = embedSpy
  embedding.init = async () => undefined

  const docWorkflow = new DocWorkflowService(parser, index, linker, embedding, storage, chunker, chunkFts)
  return { config, parser, storage, index, embedding, embedBatchSpy, embedSpy, chunker, chunkFts, docWorkflow }
}

function writeMarkdown(wiki: string, id: string, body: string, category = 'misc') {
  const docsDir = path.join(kbDir, wiki, 'docs')
  fs.mkdirSync(docsDir, { recursive: true })
  const fm = [
    '---',
    `id: ${id}`,
    `title: ${id}`,
    `category: ${category}`,
    'tags: []',
    'created: 2026-01-01',
    'updated: 2026-01-01',
    '---',
    '',
    body,
    '',
  ].join('\n')
  fs.writeFileSync(path.join(docsDir, `${id}.md`), fm, 'utf-8')
}

describe('DocWorkflowService chunk integration', () => {
  beforeEach(() => {
    freshKbDir()
  })

  afterEach(() => {
    if (fs.existsSync(kbDir)) fs.rmSync(kbDir, { recursive: true, force: true })
  })

  it('add doc: chunks written, doc embedding set', async () => {
    const aBody = 'content A '.repeat(40).trim()
    const bBody = 'content B '.repeat(40).trim()
    writeMarkdown('w', 'alpha', `# Alpha\n\nalpha intro paragraph with enough text to stand alone as a chunk ${aBody}\n\n## Section A\n\n${aBody}\n\n## Section B\n\n${bBody}`)
    const { docWorkflow, index, storage } = buildServices()
    const doc = storage.readDoc('w', 'alpha.md')
    await docWorkflow.indexAndEmbed('w', 'alpha', doc.frontmatter)

    const chunks = await index.listChunksForDoc('w', 'alpha')
    expect(chunks.length).toBeGreaterThanOrEqual(2)

    const stored = await index.getDoc('w', 'alpha')
    expect(stored).not.toBeNull()
    expect(stored?.id).toBe('alpha')
  })

  it('update doc with identical content: zero re-embed calls', async () => {
    writeMarkdown('w', 'alpha', '# Alpha\n\n## Section A\n\ncontent A\n\n## Section B\n\ncontent B')
    const services = buildServices()
    const doc = services.storage.readDoc('w', 'alpha.md')

    await services.docWorkflow.indexAndEmbed('w', 'alpha', doc.frontmatter)
    const firstCallCount = services.embedBatchSpy.mock.calls.length
    const firstTotalTexts = services.embedBatchSpy.mock.calls.reduce((sum, args) => sum + args[0].length, 0)

    await services.docWorkflow.indexAndEmbed('w', 'alpha', doc.frontmatter)

    const secondCallTexts = services.embedBatchSpy.mock.calls
      .slice(firstCallCount)
      .reduce((sum, args) => sum + args[0].length, 0)
    expect(secondCallTexts).toBe(0)
    expect(firstTotalTexts).toBeGreaterThan(0)
  })

  it('update doc with one section edited: only changed chunk re-embeds', async () => {
    writeMarkdown('w', 'alpha', '# Alpha\n\n## Section A\n\ncontent A\n\n## Section B\n\ncontent B')
    const services = buildServices()
    const docInitial = services.storage.readDoc('w', 'alpha.md')
    await services.docWorkflow.indexAndEmbed('w', 'alpha', docInitial.frontmatter)
    const baseline = services.embedBatchSpy.mock.calls.length

    writeMarkdown('w', 'alpha', '# Alpha\n\n## Section A\n\ncontent A\n\n## Section B\n\ncontent B EDITED')
    const docEdited = services.storage.readDoc('w', 'alpha.md')
    await services.docWorkflow.indexAndEmbed('w', 'alpha', docEdited.frontmatter)

    const newCalls = services.embedBatchSpy.mock.calls.slice(baseline)
    const reembedCount = newCalls.reduce((sum, args) => sum + args[0].length, 0)
    expect(reembedCount).toBe(1)
  })

  it('delete doc: chunks gone, doc row gone', async () => {
    writeMarkdown('w', 'alpha', '# Alpha\n\nbody')
    const { docWorkflow, index, storage } = buildServices()
    const doc = storage.readDoc('w', 'alpha.md')
    await docWorkflow.indexAndEmbed('w', 'alpha', doc.frontmatter)

    expect((await index.listChunksForDoc('w', 'alpha')).length).toBeGreaterThan(0)

    await docWorkflow.removeFromIndex('w', 'alpha')
    expect(await index.getDoc('w', 'alpha')).toBeNull()
    expect(await index.listChunksForDoc('w', 'alpha')).toEqual([])
  })

  it('important_sections frontmatter preserves a short TL;DR chunk through indexAndEmbed', async () => {
    const detection = 'detection-text '.repeat(40).trim()
    const docsDir = path.join(kbDir, 'w', 'docs')
    fs.mkdirSync(docsDir, { recursive: true })
    const fmContent = [
      '---',
      'id: tldr-doc',
      'title: TLDR Doc',
      'category: misc',
      'tags: []',
      'created: 2026-01-01',
      'updated: 2026-01-01',
      'important_sections:',
      '  - TL;DR',
      '---',
      '',
      '## Detection Logic',
      '',
      detection,
      '',
      '## TL;DR',
      '',
      'One line.',
      '',
    ].join('\n')
    fs.writeFileSync(path.join(docsDir, 'tldr-doc.md'), fmContent, 'utf-8')

    const { docWorkflow, index, storage } = buildServices()
    const doc = storage.readDoc('w', 'tldr-doc.md')
    expect(doc.frontmatter.importantSections).toEqual(['TL;DR'])

    await docWorkflow.indexAndEmbed('w', 'tldr-doc', doc.frontmatter)

    const chunkIds = (await index.listChunksForDoc('w', 'tldr-doc')).map((c) => c.id)
    const chunks = await index.listChunksByIds('w', chunkIds)
    const paths = chunks.map((c) => c.headingPath)
    expect(paths).toContain('TL;DR')
    expect(paths).toContain('Detection Logic')
  })

  it('lint flags a paragraph longer than 1500 chars', async () => {
    const longPara = 'word '.repeat(450).trim() // ~2249 chars, single paragraph
    expect(longPara.length).toBeGreaterThan(1500)
    writeMarkdown('w', 'longdoc', `# Long\n\n${longPara}`)
    const { docWorkflow } = buildServices()
    const issues = await docWorkflow.lint('w')
    const longParaIssues = issues.filter((i) => i.type === 'long-paragraph')
    expect(longParaIssues.length).toBe(1)
    expect(longParaIssues[0].severity).toBe('warning')
    expect(longParaIssues[0].file).toBe('longdoc.md')
  })

  it('lint does NOT flag a paragraph under 1500 chars', async () => {
    const safePara = 'word '.repeat(280).trim() // ~1399 chars
    expect(safePara.length).toBeLessThan(1500)
    writeMarkdown('w', 'safedoc', `# Safe\n\n${safePara}`)
    const { docWorkflow } = buildServices()
    const issues = await docWorkflow.lint('w')
    const longParaIssues = issues.filter((i) => i.type === 'long-paragraph')
    expect(longParaIssues.length).toBe(0)
  })

  it('lint splits paragraphs on blank lines, not on every line', async () => {
    const eight = 'word '.repeat(160).trim() // ~799 chars
    expect(eight.length).toBeLessThan(1500)
    // Two ~800-char paragraphs separated by a blank line — total >1500
    // but neither paragraph alone exceeds the threshold.
    writeMarkdown('w', 'twopara', `# Two\n\n${eight}\n\n${eight}`)
    const { docWorkflow } = buildServices()
    const issues = await docWorkflow.lint('w')
    const longParaIssues = issues.filter((i) => i.type === 'long-paragraph')
    expect(longParaIssues.length).toBe(0)
  })

  it('lint flags doc-too-short when body has fewer than 200 words', async () => {
    const tiny = 'word '.repeat(50).trim() // 50 words
    writeMarkdown('w', 'shortdoc', `# Short\n\n${tiny}`)
    const { docWorkflow } = buildServices()
    const issues = await docWorkflow.lint('w')
    const tooShort = issues.filter((i) => i.type === 'doc-too-short')
    expect(tooShort.length).toBe(1)
    expect(tooShort[0].severity).toBe('warning')
    expect(tooShort[0].file).toBe('shortdoc.md')
  })

  it('lint flags doc-too-long when body has more than 1500 words', async () => {
    // Build many short paragraphs to avoid also tripping long-paragraph
    const para = 'word '.repeat(30).trim()
    const body = Array.from({ length: 60 }, () => para).join('\n\n') // ~1800 words
    writeMarkdown('w', 'longdoc', `# Long\n\n${body}`)
    const { docWorkflow } = buildServices()
    const issues = await docWorkflow.lint('w')
    const tooLong = issues.filter((i) => i.type === 'doc-too-long')
    expect(tooLong.length).toBe(1)
    expect(tooLong[0].severity).toBe('warning')
    expect(tooLong[0].file).toBe('longdoc.md')
  })

  it('lint flags chunk-merge for a short trailing section', async () => {
    const intro = 'word '.repeat(250).trim() // 250 words, well over min-chars
    const body = `# Doc\n\n${intro}\n\n## Contacts\n\nAlice and Bob.`
    writeMarkdown('w', 'mergedoc', body)
    const { docWorkflow } = buildServices()
    const issues = await docWorkflow.lint('w')
    const merges = issues.filter((i) => i.type === 'chunk-merge')
    expect(merges.length).toBe(1)
    expect(merges[0].severity).toBe('warning')
    expect(merges[0].file).toBe('mergedoc.md')
    expect(merges[0].details).toContain('Contacts')
  })

  it('suppress_merge_warn silences the chunk-merge warning', async () => {
    const intro = 'word '.repeat(250).trim()
    const docsDir = path.join(kbDir, 'w', 'docs')
    fs.mkdirSync(docsDir, { recursive: true })
    const fmContent = [
      '---',
      'id: suppressdoc',
      'title: SuppressDoc',
      'category: misc',
      'tags: []',
      'created: 2026-01-01',
      'updated: 2026-01-01',
      'suppress_merge_warn:',
      '  - Contacts',
      '---',
      '',
      intro,
      '',
      '## Contacts',
      '',
      'Alice and Bob.',
      '',
    ].join('\n')
    fs.writeFileSync(path.join(docsDir, 'suppressdoc.md'), fmContent, 'utf-8')

    const { docWorkflow, storage } = buildServices()
    const doc = storage.readDoc('w', 'suppressdoc.md')
    expect(doc.frontmatter.suppressMergeWarn).toEqual(['Contacts'])

    const issues = await docWorkflow.lint('w')
    const merges = issues.filter((i) => i.type === 'chunk-merge')
    expect(merges.length).toBe(0)
  })

  it('suppress_lint silences doc-too-short, doc-too-long, long-paragraph, and chunk-merge', async () => {
    const docsDir = path.join(kbDir, 'w', 'docs')
    fs.mkdirSync(docsDir, { recursive: true })

    // doc-too-short
    fs.writeFileSync(
      path.join(docsDir, 'short.md'),
      [
        '---',
        'id: short',
        'title: Short',
        'category: misc',
        'tags: []',
        'created: 2026-01-01',
        'updated: 2026-01-01',
        'suppress_lint:',
        '  - doc-too-short',
        '---',
        '',
        '# Short',
        '',
        'word '.repeat(50).trim(),
        '',
      ].join('\n'),
      'utf-8',
    )

    // doc-too-long + long-paragraph (one giant paragraph triggers both)
    const giant = 'word '.repeat(1800).trim()
    fs.writeFileSync(
      path.join(docsDir, 'long.md'),
      [
        '---',
        'id: long',
        'title: Long',
        'category: misc',
        'tags: []',
        'created: 2026-01-01',
        'updated: 2026-01-01',
        'suppress_lint:',
        '  - doc-too-long',
        '  - long-paragraph',
        '---',
        '',
        '# Long',
        '',
        giant,
        '',
      ].join('\n'),
      'utf-8',
    )

    // chunk-merge (doc-wide blanket)
    const intro = 'word '.repeat(250).trim()
    fs.writeFileSync(
      path.join(docsDir, 'merge.md'),
      [
        '---',
        'id: merge',
        'title: Merge',
        'category: misc',
        'tags: []',
        'created: 2026-01-01',
        'updated: 2026-01-01',
        'suppress_lint:',
        '  - chunk-merge',
        '---',
        '',
        '# Merge',
        '',
        intro,
        '',
        '## Contacts',
        '',
        'Alice and Bob.',
        '',
      ].join('\n'),
      'utf-8',
    )

    const { docWorkflow } = buildServices()
    const issues = await docWorkflow.lint('w')

    expect(issues.filter((i) => i.file === 'short.md' && i.type === 'doc-too-short')).toHaveLength(0)
    expect(issues.filter((i) => i.file === 'long.md' && i.type === 'doc-too-long')).toHaveLength(0)
    expect(issues.filter((i) => i.file === 'long.md' && i.type === 'long-paragraph')).toHaveLength(0)
    expect(issues.filter((i) => i.file === 'merge.md' && i.type === 'chunk-merge')).toHaveLength(0)
  })

  it('important_sections opt-out: no merge happens and no chunk-merge warning', async () => {
    const intro = 'word '.repeat(250).trim()
    const docsDir = path.join(kbDir, 'w', 'docs')
    fs.mkdirSync(docsDir, { recursive: true })
    const fmContent = [
      '---',
      'id: keepdoc',
      'title: KeepDoc',
      'category: misc',
      'tags: []',
      'created: 2026-01-01',
      'updated: 2026-01-01',
      'important_sections:',
      '  - Status',
      '---',
      '',
      intro,
      '',
      '## Status',
      '',
      'Active.',
      '',
    ].join('\n')
    fs.writeFileSync(path.join(docsDir, 'keepdoc.md'), fmContent, 'utf-8')

    const { docWorkflow } = buildServices()
    const issues = await docWorkflow.lint('w')
    const merges = issues.filter((i) => i.type === 'chunk-merge')
    expect(merges.length).toBe(0)
  })

  it('lintRawDoc runs per-doc checks on arbitrary content without disk access', () => {
    const { docWorkflow } = buildServices()

    // doc-too-short on a non-existent file
    const tiny = [
      '---',
      'id: tiny',
      'title: Tiny',
      'category: misc',
      'tags: []',
      'created: 2026-01-01',
      'updated: 2026-01-01',
      '---',
      '',
      'word '.repeat(40).trim(),
      '',
    ].join('\n')
    const tinyIssues = docWorkflow.lintRawDoc(tiny, 'tiny.md')
    expect(tinyIssues.find((i) => i.type === 'doc-too-short')).toBeDefined()
    expect(tinyIssues.find((i) => i.type === 'drift')).toBeUndefined()
    expect(tinyIssues.find((i) => i.type === 'broken')).toBeUndefined()
    expect(tinyIssues.find((i) => i.type === 'orphan')).toBeUndefined()

    // missing frontmatter
    const noFm = '# Plain doc\n\n' + 'word '.repeat(300).trim()
    const noFmIssues = docWorkflow.lintRawDoc(noFm, 'nofm.md')
    const missing = noFmIssues.find((i) => i.type === 'missing')
    expect(missing).toBeDefined()
    expect(missing!.details).toContain('id')
    expect(missing!.details).toContain('title')
    expect(missing!.details).toContain('category')

    // chunk-merge surfaces on raw content (no disk needed)
    const intro = 'word '.repeat(250).trim()
    const withMergeBody = [
      '---',
      'id: m',
      'title: M',
      'category: misc',
      'tags: []',
      'created: 2026-01-01',
      'updated: 2026-01-01',
      '---',
      '',
      '# M',
      '',
      intro,
      '',
      '## Contacts',
      '',
      'Alice and Bob.',
      '',
    ].join('\n')
    const mergeIssues = docWorkflow.lintRawDoc(withMergeBody, 'm.md')
    expect(mergeIssues.find((i) => i.type === 'chunk-merge')).toBeDefined()
  })

  it('indexAndEmbed normalizes docId — passing "foo.md" stores id "foo" (no duplicate row)', async () => {
    writeMarkdown('w', 'alpha', '# Alpha\n\nbody')
    const services = buildServices()
    const doc = services.storage.readDoc('w', 'alpha.md')

    // Caller passes the corrupt form
    await services.docWorkflow.indexAndEmbed('w', 'alpha.md', doc.frontmatter)

    // Index has exactly one row, with the canonical (.md-stripped) id
    const all = await services.index.listDocs('w')
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe('alpha')
    expect(all[0].id).not.toContain('.md')
  })

  it('lint flags corrupt-id rows and --fix removes them', async () => {
    writeMarkdown('w', 'beta', '# Beta\n\nbody content here')
    const services = buildServices()
    const doc = services.storage.readDoc('w', 'beta.md')

    // Index the doc properly
    await services.docWorkflow.indexAndEmbed('w', 'beta', doc.frontmatter)

    // Plant a corrupt row directly via index.upsertDoc (simulating pre-fix
    // versions that wrote id="beta.md" alongside id="beta")
    await services.index.upsertDoc('w', {
      id: 'beta.md',
      title: 'Beta',
      category: 'misc',
      tags: [],
      filePath: 'beta.md',
      contentHash: 'x'.repeat(32),
    })

    const beforeCount = (await services.index.listDocs('w')).length
    expect(beforeCount).toBe(2)

    const issues = await services.docWorkflow.lint('w')
    const corrupt = issues.filter((i) => i.type === 'corrupt-id')
    expect(corrupt).toHaveLength(1)
    expect(corrupt[0].severity).toBe('error')
    expect(corrupt[0].details).toContain('id="beta.md"')

    const repairs = await services.docWorkflow.lintFix('w', corrupt)
    expect(repairs).toHaveLength(1)
    expect(repairs[0]).toMatchObject({ type: 'corrupt-id' })

    const afterDocs = await services.index.listDocs('w')
    expect(afterDocs).toHaveLength(1)
    expect(afterDocs[0].id).toBe('beta') // canonical row survived
  })

  it('lintFix on drift fully re-indexes the doc (not just contentHash bump)', async () => {
    writeMarkdown('w', 'alpha', '# Alpha\n\n' + 'word '.repeat(80).trim())
    const services = buildServices()
    const docInitial = services.storage.readDoc('w', 'alpha.md')
    await services.docWorkflow.indexAndEmbed('w', 'alpha', docInitial.frontmatter)
    const beforeCount = services.embedBatchSpy.mock.calls.length

    // Edit the file directly on disk to simulate drift.
    writeMarkdown('w', 'alpha', '# Alpha\n\n' + 'completely different content '.repeat(20).trim())

    const issues = await services.docWorkflow.lint('w')
    const drift = issues.filter((i) => i.type === 'drift')
    expect(drift.length).toBe(1)

    const repairs = await services.docWorkflow.lintFix('w', drift)
    expect(repairs).toHaveLength(1)
    expect(repairs[0]).toMatchObject({ type: 'drift', file: 'alpha.md' })

    // Embedding pass must have run again — proves chunks were rebuilt, not
    // just the doc-row hash bumped.
    expect(services.embedBatchSpy.mock.calls.length).toBeGreaterThan(beforeCount)

    // And the next lint should find no drift.
    const afterIssues = await services.docWorkflow.lint('w')
    expect(afterIssues.filter((i) => i.type === 'drift').length).toBe(0)
  })

  it('reindex: drops all and rebuilds chunks for every file', async () => {
    writeMarkdown('w', 'one', '# One\n\nbody one')
    writeMarkdown('w', 'two', '# Two\n\nbody two')
    writeMarkdown('w', 'three', '# Three\n\nbody three')

    const services = buildServices()
    for (const id of ['one', 'two', 'three']) {
      const doc = services.storage.readDoc('w', `${id}.md`)
      await services.docWorkflow.indexAndEmbed('w', id, doc.frontmatter)
    }
    expect(await services.index.countDocs('w')).toBe(3)

    const result = await services.docWorkflow.reindex('w')
    expect(result.count).toBe(3)
    expect(await services.index.countDocs('w')).toBe(3)
    for (const id of ['one', 'two', 'three']) {
      const chunks = await services.index.listChunksForDoc('w', id)
      expect(chunks.length).toBeGreaterThan(0)
    }
  })
})
