import { describe, it, expect } from 'vitest'
import { parseLineRange } from '../src/utils/slug.js'

describe('parseLineRange', () => {
  it('parses a plain start-end range', () => {
    expect(parseLineRange('5-20')).toEqual({ start: 5, end: 20 })
  })

  it('open-ended range "5-" returns end as Infinity', () => {
    expect(parseLineRange('5-')).toEqual({ start: 5, end: Infinity })
  })

  it('range "-20" defaults start to 1', () => {
    expect(parseLineRange('-20')).toEqual({ start: 1, end: 20 })
  })

  it('single number "50" means from 50 to end', () => {
    expect(parseLineRange('50')).toEqual({ start: 50, end: Infinity })
  })

  it('empty string returns full open range', () => {
    expect(parseLineRange('')).toEqual({ start: 1, end: Infinity })
  })

  it('undefined returns full open range', () => {
    expect(parseLineRange(undefined as unknown as string)).toEqual({ start: 1, end: Infinity })
  })

  it('positive context expands the range on both sides', () => {
    expect(parseLineRange('10-20', 5)).toEqual({ start: 5, end: 25 })
  })

  it('context that would push start below 1 clamps to 1', () => {
    expect(parseLineRange('3-20', 10)).toEqual({ start: 1, end: 30 })
  })

  it('malformed input falls back to full open range', () => {
    expect(parseLineRange('foo-bar')).toEqual({ start: 1, end: Infinity })
  })

  it('context with open-ended range leaves end as Infinity', () => {
    expect(parseLineRange('5-', 3)).toEqual({ start: 2, end: Infinity })
  })
})
