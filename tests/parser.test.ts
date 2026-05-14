import { describe, it, expect } from 'vitest'
import { ParserService } from '../src/services/parser.service.js'

describe('ParserService frontmatter round-trip', () => {
  const parser = new ParserService()

  it('preserves important_sections, suppress_merge_warn, suppress_lint through serialize → parse', () => {
    const original = [
      '---',
      'id: round-trip',
      'title: Round Trip',
      'category: misc',
      'tags:',
      '  - a',
      '  - b',
      'created: 2026-01-01',
      'updated: 2026-01-01',
      'important_sections:',
      '  - TL;DR',
      '  - Status',
      'suppress_merge_warn:',
      '  - See Also',
      'suppress_lint:',
      '  - doc-too-short',
      '  - chunk-merge',
      '---',
      '',
      '# Round Trip',
      '',
      'body',
      '',
    ].join('\n')

    const parsed = parser.parse(original)
    expect(parsed.frontmatter.importantSections).toEqual(['TL;DR', 'Status'])
    expect(parsed.frontmatter.suppressMergeWarn).toEqual(['See Also'])
    expect(parsed.frontmatter.suppressLint).toEqual(['doc-too-short', 'chunk-merge'])

    const serialized = parser.serialize(parsed.frontmatter, parsed.body)
    expect(serialized).toContain('important_sections:')
    expect(serialized).toContain('suppress_merge_warn:')
    expect(serialized).toContain('suppress_lint:')

    const reparsed = parser.parse(serialized)
    expect(reparsed.frontmatter.importantSections).toEqual(['TL;DR', 'Status'])
    expect(reparsed.frontmatter.suppressMergeWarn).toEqual(['See Also'])
    expect(reparsed.frontmatter.suppressLint).toEqual(['doc-too-short', 'chunk-merge'])
  })

  it('omits opt-out fields entirely when absent (no empty arrays leak in)', () => {
    const original = [
      '---',
      'id: plain',
      'title: Plain',
      'category: misc',
      'tags: []',
      'created: 2026-01-01',
      'updated: 2026-01-01',
      '---',
      '',
      'body',
      '',
    ].join('\n')

    const parsed = parser.parse(original)
    expect(parsed.frontmatter.importantSections).toBeUndefined()
    expect(parsed.frontmatter.suppressMergeWarn).toBeUndefined()
    expect(parsed.frontmatter.suppressLint).toBeUndefined()

    const serialized = parser.serialize(parsed.frontmatter, parsed.body)
    expect(serialized).not.toContain('important_sections')
    expect(serialized).not.toContain('suppress_merge_warn')
    expect(serialized).not.toContain('suppress_lint')
  })
})
