import { describe, it, expect } from 'vitest'
import { normalizeDocId, toFilename, toDocId, slugify } from '../src/utils/slug.js'

describe('normalizeDocId', () => {
  it('passes through a bare id', () => {
    expect(normalizeDocId('foo')).toBe('foo')
    expect(normalizeDocId('foo-bar-baz')).toBe('foo-bar-baz')
  })

  it('strips a trailing .md (lowercase)', () => {
    expect(normalizeDocId('foo.md')).toBe('foo')
    expect(normalizeDocId('docker-basics.md')).toBe('docker-basics')
  })

  it('strips a trailing .md (case-insensitive)', () => {
    expect(normalizeDocId('foo.MD')).toBe('foo')
    expect(normalizeDocId('foo.Md')).toBe('foo')
  })

  it('strips a leading ./ (markdown link form)', () => {
    expect(normalizeDocId('./foo.md')).toBe('foo')
    expect(normalizeDocId('./foo')).toBe('foo')
  })

  it('takes the basename of a full path', () => {
    expect(normalizeDocId('/Users/me/.kb/wiki/docs/foo.md')).toBe('foo')
    expect(normalizeDocId('docs/foo.md')).toBe('foo')
    expect(normalizeDocId('C:\\Users\\me\\foo.md')).toBe('foo')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeDocId('  foo.md  ')).toBe('foo')
    expect(normalizeDocId('\tfoo\n')).toBe('foo')
  })

  it('is idempotent and lowercases (kb ids are always lowercase)', () => {
    const once = normalizeDocId('./docs/Foo.MD')
    const twice = normalizeDocId(once)
    expect(twice).toBe(once)
    expect(twice).toBe('foo')
  })

  it('lowercases for canonical form on case-insensitive filesystems', () => {
    expect(normalizeDocId('TEST-DOC.MD')).toBe('test-doc')
    expect(normalizeDocId('MixedCase')).toBe('mixedcase')
  })

  it('handles already-corrupted .md.md inputs', () => {
    // A single pass strips only one .md — this is correct: corrupted index
    // rows are healed by lint, not by silent over-stripping that could
    // mask a genuine ".md.md" in someone's id (unlikely but possible).
    expect(normalizeDocId('foo.md.md')).toBe('foo.md')
  })

  it('handles empty / null-ish inputs gracefully', () => {
    expect(normalizeDocId('')).toBe('')
    expect(normalizeDocId('   ')).toBe('')
    expect(normalizeDocId(undefined as unknown as string)).toBe('')
    expect(normalizeDocId(null as unknown as string)).toBe('')
  })

  it('preserves dots that are not the .md extension', () => {
    expect(normalizeDocId('v1.2.3-notes.md')).toBe('v1.2.3-notes')
  })
})

describe('toFilename + normalizeDocId round-trip', () => {
  it('every accepted input form produces the same filename', () => {
    const forms = ['foo', 'foo.md', './foo.md', 'docs/foo.md', '  foo.MD  ']
    const filenames = forms.map((f) => toFilename(normalizeDocId(f)))
    expect(new Set(filenames).size).toBe(1)
    expect(filenames[0]).toBe('foo.md')
  })
})

describe('existing utilities unchanged', () => {
  it('toFilename is idempotent', () => {
    expect(toFilename('foo')).toBe('foo.md')
    expect(toFilename('foo.md')).toBe('foo.md')
  })

  it('toDocId strips trailing .md', () => {
    expect(toDocId('foo.md')).toBe('foo')
    expect(toDocId('foo')).toBe('foo')
  })

  it('slugify converts title to slug', () => {
    expect(slugify('Docker Basics')).toBe('docker-basics')
    expect(slugify('Foo.md')).toBe('foo-md')
  })
})
