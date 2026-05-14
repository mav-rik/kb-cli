import { describe, it, expect } from 'vitest'
import { ChunkerService, type ChunkInput } from '../src/services/chunker.service.js'

const chunker = new ChunkerService()

function fm(body: string): string {
  return ['---', 'id: doc', 'title: Doc Title', 'category: misc', 'tags: []', 'created: 2026-01-01', 'updated: 2026-01-01', '---', '', body].join('\n')
}

// Most tests use small fixtures that would be swallowed by the default
// minBodyChars merge — disable merging unless a test specifically exercises it.
function chunkSmall(input: ChunkInput, opts: { bodyCharBudget?: number } = {}) {
  return chunker.chunk(input, { minBodyChars: 0, ...opts })
}

describe('ChunkerService.chunk', () => {
  it('returns [] for frontmatter-only doc with empty body', () => {
    const raw = ['---', 'id: doc', 'title: T', 'category: misc', 'tags: []', 'created: 2026-01-01', 'updated: 2026-01-01', '---', ''].join('\n')
    const chunks = chunker.chunk({ docId: 'doc', title: 'T', rawFileContent: raw })
    expect(chunks).toEqual([])
  })

  it('returns [] for whitespace-only body', () => {
    const raw = fm('   \n\n   \n')
    const chunks = chunker.chunk({ docId: 'doc', title: 'T', rawFileContent: raw })
    expect(chunks).toEqual([])
  })

  it('body with no headings fitting budget produces a single root chunk', () => {
    const raw = fm('hello world this is the body')
    const chunks = chunker.chunk({ docId: 'doc', title: 'Doc Title', rawFileContent: raw })
    expect(chunks.length).toBe(1)
    expect(chunks[0].heading).toBeUndefined()
    expect(chunks[0].headingPath).toBe('Doc Title')
    expect(chunks[0].headingLevel).toBe(0)
  })

  it('body with no headings exceeding budget splits by paragraph with stable headingPath', () => {
    const big = 'aaa '.repeat(400).trim()
    const body = `${big}\n\n${big}\n\n${big}`
    const raw = fm(body)
    const chunks = chunker.chunk({ docId: 'doc', title: 'Doc Title', rawFileContent: raw }, { bodyCharBudget: 500 })
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    for (const c of chunks) {
      expect(c.headingPath).toBe('Doc Title')
      expect(c.heading).toBeUndefined()
    }
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].position).toBe(chunks[i - 1].position + 1)
    }
  })

  it('single H2 section yields one chunk with heading path', () => {
    const raw = fm('## Section\n\nsome content under section')
    const chunks = chunker.chunk({ docId: 'doc', title: 'Doc Title', rawFileContent: raw })
    expect(chunks.length).toBe(1)
    expect(chunks[0].heading).toBe('Section')
    expect(chunks[0].headingPath).toBe('Section')
    expect(chunks[0].headingLevel).toBe(2)
  })

  it('H2 with two H3 children and intro: three chunks with hierarchical paths', () => {
    const body = [
      '## Architecture',
      '',
      'intro paragraph for architecture',
      '',
      '### Services',
      '',
      'services content',
      '',
      '### Storage',
      '',
      'storage content',
    ].join('\n')
    const chunks = chunkSmall({ docId: 'doc', title: 'Doc', rawFileContent: fm(body) })
    expect(chunks.length).toBe(3)
    expect(chunks[0].headingPath).toBe('Architecture')
    expect(chunks[0].headingLevel).toBe(2)
    expect(chunks[1].headingPath).toBe('Architecture > Services')
    expect(chunks[1].headingLevel).toBe(3)
    expect(chunks[2].headingPath).toBe('Architecture > Storage')
    expect(chunks[2].headingLevel).toBe(3)
  })

  it('H2 with H3 child but no intro produces only the child chunks', () => {
    const body = [
      '## Architecture',
      '### Services',
      '',
      'services content',
      '',
      '### Storage',
      '',
      'storage content',
    ].join('\n')
    const chunks = chunkSmall({ docId: 'doc', title: 'Doc', rawFileContent: fm(body) })
    expect(chunks.length).toBe(2)
    const paths = chunks.map(c => c.headingPath).sort()
    expect(paths).toEqual(['Architecture > Services', 'Architecture > Storage'])
  })

  it('two H2 siblings yield two chunks with their own paths', () => {
    const body = [
      '## Alpha',
      '',
      'alpha body',
      '',
      '## Beta',
      '',
      'beta body',
    ].join('\n')
    const chunks = chunkSmall({ docId: 'doc', title: 'Doc', rawFileContent: fm(body) })
    expect(chunks.length).toBe(2)
    expect(chunks[0].headingPath).toBe('Alpha')
    expect(chunks[1].headingPath).toBe('Beta')
  })

  it('# inside a code fence is not treated as a heading', () => {
    const body = [
      '## Section',
      '',
      'before code',
      '',
      '```python',
      '# this is a comment',
      '# another comment',
      '```',
      '',
      'after code',
    ].join('\n')
    const chunks = chunker.chunk({ docId: 'doc', title: 'Doc', rawFileContent: fm(body) })
    expect(chunks.length).toBe(1)
    expect(chunks[0].heading).toBe('Section')
  })

  it('# inside a tilde fence is not treated as a heading', () => {
    const body = [
      '## Section',
      '',
      'before',
      '',
      '~~~',
      '# fake heading inside tilde',
      '~~~',
      '',
      'after',
    ].join('\n')
    const chunks = chunker.chunk({ docId: 'doc', title: 'Doc', rawFileContent: fm(body) })
    expect(chunks.length).toBe(1)
    expect(chunks[0].heading).toBe('Section')
  })

  it('indented # in a list item is not treated as a heading', () => {
    const body = [
      '## Section',
      '',
      '- # not a heading',
      '- another item',
    ].join('\n')
    const chunks = chunker.chunk({ docId: 'doc', title: 'Doc', rawFileContent: fm(body) })
    expect(chunks.length).toBe(1)
    expect(chunks[0].heading).toBe('Section')
  })

  it('line numbers include frontmatter offset', () => {
    const raw = [
      '---',
      'id: doc',
      'title: T',
      'category: misc',
      'tags: []',
      'created: 2026-01-01',
      'updated: 2026-01-01',
      '---',
      '',
      '# Heading',
      '',
      'body line',
    ].join('\n')
    const chunks = chunker.chunk({ docId: 'doc', title: 'T', rawFileContent: raw })
    expect(chunks.length).toBe(1)
    expect(chunks[0].fromLine).toBeGreaterThan(8)
    expect(chunks[0].fromLine).toBeLessThanOrEqual(chunks[0].toLine)
  })

  it('produces identical chunk IDs across repeated chunking of the same input', () => {
    const body = [
      '## Alpha',
      '',
      'alpha body',
      '',
      '## Beta',
      '',
      'beta body',
    ].join('\n')
    const raw = fm(body)
    const a = chunkSmall({ docId: 'doc', title: 'Doc', rawFileContent: raw })
    const b = chunkSmall({ docId: 'doc', title: 'Doc', rawFileContent: raw })
    expect(a.map(c => c.id)).toEqual(b.map(c => c.id))
    expect(a.map(c => c.contentHash)).toEqual(b.map(c => c.contentHash))
  })

  it('editing one section changes only that chunk contentHash', () => {
    const body1 = ['## Alpha', '', 'alpha body', '', '## Beta', '', 'beta body'].join('\n')
    const body2 = ['## Alpha', '', 'alpha body', '', '## Beta', '', 'beta body CHANGED'].join('\n')
    const a = chunkSmall({ docId: 'doc', title: 'Doc', rawFileContent: fm(body1) })
    const b = chunkSmall({ docId: 'doc', title: 'Doc', rawFileContent: fm(body2) })
    expect(a.length).toBe(b.length)

    const aByPath = new Map(a.map(c => [c.headingPath, c]))
    const bByPath = new Map(b.map(c => [c.headingPath, c]))

    expect(aByPath.get('Alpha')!.contentHash).toBe(bByPath.get('Alpha')!.contentHash)
    expect(aByPath.get('Beta')!.contentHash).not.toBe(bByPath.get('Beta')!.contentHash)
  })

  it('embeddingInput starts with title line and includes headingPath plus body slice', () => {
    const body = '## Section\n\nbody content word'
    const chunks = chunker.chunk({
      docId: 'doc',
      title: 'My Title',
      category: 'cat1',
      tags: ['t1', 't2'],
      rawFileContent: fm(body),
    })
    expect(chunks.length).toBe(1)
    const lines = chunks[0].embeddingInput.split('\n')
    expect(lines[0]).toBe('My Title')
    expect(chunks[0].embeddingInput).toContain('Section')
    expect(chunks[0].embeddingInput).toContain('body content word')
    expect(chunks[0].embeddingInput).toContain('cat1')
    expect(chunks[0].embeddingInput).toContain('t1, t2')
  })

  it('embeddingInput for a no-heading doc still has title preamble', () => {
    const raw = fm('plain body without heading')
    const chunks = chunker.chunk({ docId: 'doc', title: 'Doc Title', rawFileContent: raw })
    expect(chunks.length).toBe(1)
    expect(chunks[0].embeddingInput.split('\n')[0]).toBe('Doc Title')
    expect(chunks[0].embeddingInput).toContain('plain body without heading')
  })

  it('tiny meta-section under threshold is merged into previous chunk', () => {
    const detection = 'detection-text '.repeat(40).trim()
    const body = [
      '## Detection Logic',
      '',
      detection,
      '',
      '## Contacts',
      '',
      'Alice and Bob',
    ].join('\n')
    const chunks = chunker.chunk({ docId: 'doc', title: 'Doc', rawFileContent: fm(body) })
    expect(chunks.length).toBe(1)
    expect(chunks[0].headingPath).toBe('Detection Logic')
    expect(chunks[0].embeddingInput).toContain('Detection Logic')
    expect(chunks[0].embeddingInput).toContain('Contacts')
    expect(chunks[0].embeddingInput).toContain('Alice and Bob')
    // Line range covers both sections.
    const totalLines = fm(body).split('\n').length
    expect(chunks[0].toLine).toBeGreaterThanOrEqual(totalLines - 1)
  })

  it('multiple consecutive tiny chunks chain into the previous substantive chunk', () => {
    const detection = 'detection-text '.repeat(40).trim()
    const body = [
      '## Detection Logic',
      '',
      detection,
      '',
      '## Contacts',
      '',
      'Alice',
      '',
      '## Related',
      '',
      'foo.md',
      '',
      '## See Also',
      '',
      'bar.md',
    ].join('\n')
    const chunks = chunker.chunk({ docId: 'doc', title: 'Doc', rawFileContent: fm(body) })
    expect(chunks.length).toBe(1)
    expect(chunks[0].headingPath).toBe('Detection Logic')
    expect(chunks[0].embeddingInput).toContain('Contacts')
    expect(chunks[0].embeddingInput).toContain('Related')
    expect(chunks[0].embeddingInput).toContain('See Also')
    expect(chunks[0].embeddingInput).toContain('Alice')
    expect(chunks[0].embeddingInput).toContain('foo.md')
    expect(chunks[0].embeddingInput).toContain('bar.md')
    const totalLines = fm(body).split('\n').length
    expect(chunks[0].toLine).toBeGreaterThanOrEqual(totalLines - 1)
  })

  it('first chunk being tiny is kept as-is', () => {
    const body = '## Intro\n\nshort intro text'
    const chunks = chunker.chunk({ docId: 'doc', title: 'Doc', rawFileContent: fm(body) })
    expect(chunks.length).toBe(1)
    expect(chunks[0].headingPath).toBe('Intro')
    expect(chunks[0].embeddingInput).toContain('short intro text')
  })

  it('merging is disabled when minBodyChars=0', () => {
    const detection = 'detection-text '.repeat(40).trim()
    const body = [
      '## Detection Logic',
      '',
      detection,
      '',
      '## Contacts',
      '',
      'Alice and Bob',
    ].join('\n')
    const chunks = chunkSmall({ docId: 'doc', title: 'Doc', rawFileContent: fm(body) })
    expect(chunks.length).toBe(2)
    expect(chunks[0].headingPath).toBe('Detection Logic')
    expect(chunks[1].headingPath).toBe('Contacts')
  })

  it('link-heavy short body still merges (length rule catches it)', () => {
    const detection = 'detection-text '.repeat(40).trim()
    const body = [
      '## Detection Logic',
      '',
      detection,
      '',
      '## Related',
      '',
      '[a](./a.md) [b](./b.md)',
    ].join('\n')
    const chunks = chunker.chunk({ docId: 'doc', title: 'Doc', rawFileContent: fm(body) })
    expect(chunks.length).toBe(1)
    expect(chunks[0].headingPath).toBe('Detection Logic')
    expect(chunks[0].embeddingInput).toContain('Related')
  })

  it('link-heavy long body merges despite being over the length threshold', () => {
    const detection = 'detection-text '.repeat(40).trim()
    const links = Array.from({ length: 12 }, (_, i) => `- [rule-${i}](./rule-${i}.md)`).join('\n')
    const body = [
      '## Detection Logic',
      '',
      detection,
      '',
      '## Related Rules',
      '',
      links,
    ].join('\n')
    // Sanity check: the link-list body is well over the 80-char threshold.
    expect(links.length).toBeGreaterThan(200)
    const chunks = chunker.chunk({ docId: 'doc', title: 'Doc', rawFileContent: fm(body) })
    expect(chunks.length).toBe(1)
    expect(chunks[0].headingPath).toBe('Detection Logic')
    expect(chunks[0].embeddingInput).toContain('Related Rules')
    expect(chunks[0].embeddingInput).toContain('rule-0.md')
  })

  it('non-link-heavy long body does NOT merge', () => {
    const detection = 'detection-text '.repeat(40).trim()
    const prose = 'This is substantial prose content that contains real sentences and not just a pile of links. '.repeat(5).trim()
    const body = [
      '## Detection Logic',
      '',
      detection,
      '',
      '## Discussion',
      '',
      prose,
    ].join('\n')
    expect(prose.length).toBeGreaterThan(200)
    const chunks = chunker.chunk({ docId: 'doc', title: 'Doc', rawFileContent: fm(body) })
    expect(chunks.length).toBe(2)
    expect(chunks[0].headingPath).toBe('Detection Logic')
    expect(chunks[1].headingPath).toBe('Discussion')
  })

  it('important_sections opt-out beats length rule', () => {
    const detection = 'detection-text '.repeat(40).trim()
    const body = [
      '## Detection Logic',
      '',
      detection,
      '',
      '## TL;DR',
      '',
      'One-line summary.',
    ].join('\n')
    const chunks = chunker.chunk({
      docId: 'doc',
      title: 'Doc',
      rawFileContent: fm(body),
      importantSections: ['TL;DR'],
    })
    expect(chunks.length).toBe(2)
    expect(chunks[0].headingPath).toBe('Detection Logic')
    expect(chunks[1].headingPath).toBe('TL;DR')
    expect(chunks[1].embeddingInput).toContain('One-line summary')
  })

  it('important_sections opt-out beats link-heavy rule', () => {
    const detection = 'detection-text '.repeat(40).trim()
    const links = Array.from({ length: 12 }, (_, i) => `- [ref-${i}](./ref-${i}.md)`).join('\n')
    const body = [
      '## Detection Logic',
      '',
      detection,
      '',
      '## References',
      '',
      links,
    ].join('\n')
    const chunks = chunker.chunk({
      docId: 'doc',
      title: 'Doc',
      rawFileContent: fm(body),
      importantSections: ['References'],
    })
    expect(chunks.length).toBe(2)
    expect(chunks[1].headingPath).toBe('References')
  })

  it('important_sections matching is case-insensitive', () => {
    const detection = 'detection-text '.repeat(40).trim()
    const body = [
      '## Detection Logic',
      '',
      detection,
      '',
      '## TL;DR',
      '',
      'Tiny.',
    ].join('\n')
    const chunks = chunker.chunk({
      docId: 'doc',
      title: 'Doc',
      rawFileContent: fm(body),
      importantSections: ['tl;dr'],
    })
    expect(chunks.length).toBe(2)
    expect(chunks[1].headingPath).toBe('TL;DR')
  })
})
