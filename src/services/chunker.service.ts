import { contentHash } from '../utils/hash.js'

export interface ChunkInput {
  docId: string
  title: string
  category?: string
  tags?: string[]
  rawFileContent: string
  importantSections?: string[]
}

export interface ChunkRecord {
  id: string
  docId: string
  heading?: string
  headingPath?: string
  headingLevel?: number
  fromLine: number
  toLine: number
  position: number
  contentHash: string
  embeddingInput: string
}

interface Section {
  level: number
  heading?: string
  line: number
  parent?: Section
  children: Section[]
  introEnd: number
}

const DEFAULT_BODY_CHAR_BUDGET = 1500
// 160 chars is the aggressive default now that `important_sections` exists as
// the per-doc opt-out — authors can rescue a deliberately short section
// (TL;DR, Status) without us being conservative for everyone. Combined with
// the link-heavy 50% rule this catches Contacts/See Also/Related blocks that
// 80 still let through. See RESULTS-02.md (80-char baseline) and the
// forthcoming RESULTS-04.md for calibration deltas.
const DEFAULT_MIN_BODY_CHARS = 160

interface DraftChunk {
  record: ChunkRecord
  bodyText: string
}

export class ChunkerService {
  chunk(
    input: ChunkInput,
    options?: { bodyCharBudget?: number; minBodyChars?: number },
  ): ChunkRecord[] {
    return this.chunkWithMergeReport(input, options).chunks
  }

  /**
   * Returns merged chunks AND the drafts that got folded away in the merge
   * pass. Used by lint to surface chunk-merge warnings without running the
   * heavy draft-building twice.
   */
  chunkWithMergeReport(
    input: ChunkInput,
    options?: { bodyCharBudget?: number; minBodyChars?: number },
  ): { chunks: ChunkRecord[]; mergedAway: ChunkRecord[] } {
    const drafts = this.buildDrafts(input, options?.bodyCharBudget ?? DEFAULT_BODY_CHAR_BUDGET)
    const minBodyChars = options?.minBodyChars ?? DEFAULT_MIN_BODY_CHARS
    if (minBodyChars <= 0) return { chunks: drafts.map(d => d.record), mergedAway: [] }
    const chunks = this.mergeTinyChunks(drafts, minBodyChars, input.importantSections)
    const survived = new Set(chunks.map(c => c.id))
    const mergedAway = drafts.filter(d => !survived.has(d.record.id)).map(d => d.record)
    return { chunks, mergedAway }
  }

  private buildDrafts(input: ChunkInput, budget: number): DraftChunk[] {
    const lines = input.rawFileContent.split('\n')
    const totalLines = lines.length
    const bodyStartLine = this.detectBodyStart(lines)
    if (bodyStartLine > totalLines) return []

    const root = this.buildTree(lines, bodyStartLine, totalLines)
    const drafts: DraftChunk[] = []
    let position = 0
    const visit = (section: Section): void => {
      const isRoot = section === root
      const introStart = isRoot ? bodyStartLine : section.line
      const firstChild = section.children[0]
      const introEnd = firstChild ? firstChild.line - 1 : section.introEnd

      if (introEnd >= introStart) {
        const sliceLines = lines.slice(introStart - 1, introEnd)
        const bodyOffset = isRoot ? 0 : 1
        const bodyStart = isRoot ? introStart : introStart + 1
        const bodyText = sliceLines.slice(bodyOffset).join('\n')

        if (bodyText.trim().length > 0) {
          const headingPath = this.buildHeadingPath(section, input.title)
          const bins = this.packIntoBins(sliceLines, bodyOffset, bodyStart, budget)
          for (let i = 0; i < bins.length; i++) {
            const bin = bins[i]!
            drafts.push({
              record: this.emitChunk(input, section, headingPath, bin, i, position++),
              bodyText: bin.text,
            })
          }
        }
      }
      for (const child of section.children) visit(child)
    }
    visit(root)
    return drafts
  }

  private mergeTinyChunks(
    drafts: { record: ChunkRecord; bodyText: string }[],
    minBodyChars: number,
    importantSections?: string[],
  ): ChunkRecord[] {
    const important = new Set((importantSections ?? []).map(s => s.toLowerCase()))
    const merged: { record: ChunkRecord; bodyText: string }[] = []
    for (const draft of drafts) {
      if (merged.length === 0) {
        merged.push(draft)
        continue
      }
      const headingLower = draft.record.heading?.toLowerCase()
      // important_sections is the author-controlled escape hatch: short-but-critical
      // sections (TL;DR, Status) bypass both length and link-density rules.
      if (headingLower && important.has(headingLower)) {
        merged.push(draft)
        continue
      }
      const bodyLen = draft.bodyText.length
      const linkChars = this.countLinkChars(draft.bodyText)
      // >50% chars inside [text](url) flags link-list sections (Related Rules,
      // See Also) that are too long to hit minBodyChars but lack substance.
      const isLinkHeavy = bodyLen > 0 && linkChars / bodyLen > 0.5
      if (bodyLen < minBodyChars || isLinkHeavy) {
        const prev = merged[merged.length - 1]!
        const headingLine = draft.record.heading
          ? `${draft.record.headingPath ?? draft.record.heading}\n`
          : ''
        prev.record.toLine = draft.record.toLine
        prev.record.embeddingInput = `${prev.record.embeddingInput}\n\n${headingLine}${draft.bodyText}`
        prev.bodyText = `${prev.bodyText}\n\n${headingLine}${draft.bodyText}`
        prev.record.contentHash = contentHash(prev.record.embeddingInput).slice(0, 32)
      } else {
        merged.push(draft)
      }
    }
    return merged.map(m => m.record)
  }

  private countLinkChars(text: string): number {
    const re = /\[([^\]]+)\]\(([^)]+)\)/g
    let total = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) total += m[0].length
    return total
  }

  private detectBodyStart(lines: string[]): number {
    if (lines.length === 0 || lines[0] !== '---') return 1
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] === '---') return i + 2
    }
    return lines.length + 1
  }

  private buildTree(lines: string[], bodyStartLine: number, totalLines: number): Section {
    const root: Section = { level: 0, line: bodyStartLine, children: [], introEnd: totalLines }
    const stack: Section[] = [root]
    let inFence = false

    for (let i = bodyStartLine - 1; i < lines.length; i++) {
      const line = lines[i]!
      if (/^(`{3,}|~{3,})/.test(line)) {
        inFence = !inFence
        continue
      }
      if (inFence) continue
      const m = /^(#{1,6})\s+(.+)$/.exec(line)
      if (!m) continue

      const level = m[1]!.length
      const lineNo = i + 1
      while (stack.length > 1 && stack[stack.length - 1]!.level >= level) {
        stack.pop()!.introEnd = lineNo - 1
      }
      const parent = stack[stack.length - 1]!
      parent.introEnd = lineNo - 1
      const section: Section = {
        level,
        heading: m[2]!.trim(),
        line: lineNo,
        parent,
        children: [],
        introEnd: totalLines,
      }
      parent.children.push(section)
      stack.push(section)
    }
    return root
  }

  private buildHeadingPath(section: Section, title: string): string {
    if (section.level === 0) return title
    const parts: string[] = []
    for (let cur: Section | undefined = section; cur && cur.level > 0; cur = cur.parent) {
      if (cur.heading) parts.unshift(cur.heading)
    }
    return parts.join(' > ')
  }

  private packIntoBins(
    sliceLines: string[],
    bodyOffset: number,
    bodyStartLine: number,
    budget: number,
  ): Array<{ text: string; fromLine: number; toLine: number }> {
    const bodyLines = sliceLines.slice(bodyOffset)
    const bodyText = bodyLines.join('\n')
    if (bodyText.length <= budget) {
      return [{ text: bodyText, fromLine: bodyStartLine, toLine: bodyStartLine + bodyLines.length - 1 }]
    }

    const paragraphs: Array<{ text: string; fromLine: number; toLine: number }> = []
    let curStart = 0
    let i = 0
    while (i < bodyLines.length) {
      if (bodyLines[i]!.trim() === '') {
        if (i > curStart) {
          paragraphs.push({
            text: bodyLines.slice(curStart, i).join('\n'),
            fromLine: bodyStartLine + curStart,
            toLine: bodyStartLine + i - 1,
          })
        }
        while (i < bodyLines.length && bodyLines[i]!.trim() === '') i++
        curStart = i
      } else {
        i++
      }
    }
    if (curStart < bodyLines.length) {
      paragraphs.push({
        text: bodyLines.slice(curStart).join('\n'),
        fromLine: bodyStartLine + curStart,
        toLine: bodyStartLine + bodyLines.length - 1,
      })
    }

    const bins: Array<{ text: string; fromLine: number; toLine: number }> = []
    let current: { text: string; fromLine: number; toLine: number } | null = null
    for (const p of paragraphs) {
      if (current === null) {
        current = { ...p }
        continue
      }
      const merged = `${current.text}\n\n${p.text}`
      if (merged.length <= budget) {
        current.text = merged
        current.toLine = p.toLine
      } else {
        bins.push(current)
        current = { ...p }
      }
    }
    if (current !== null) bins.push(current)
    return bins
  }

  private emitChunk(
    input: ChunkInput,
    section: Section,
    headingPath: string,
    bin: { text: string; fromLine: number; toLine: number },
    partIndex: number,
    position: number,
  ): ChunkRecord {
    const metaLine = [input.category, input.tags?.length ? input.tags.join(', ') : '']
      .filter(s => s && s.length > 0)
      .join(' | ')
    const headerLines = [input.title]
    if (metaLine) headerLines.push(metaLine)
    headerLines.push(headingPath || input.title)
    const embeddingInput = `${headerLines.join('\n')}\n\n${bin.text}`

    const record: ChunkRecord = {
      id: contentHash(`${input.docId}\x00${headingPath}\x00${partIndex}`).slice(0, 32),
      docId: input.docId,
      headingPath: headingPath || undefined,
      headingLevel: section.level,
      fromLine: bin.fromLine,
      toLine: bin.toLine,
      position,
      contentHash: contentHash(embeddingInput).slice(0, 32),
      embeddingInput,
    }
    if (section.level !== 0 && section.heading !== undefined) record.heading = section.heading
    return record
  }
}
