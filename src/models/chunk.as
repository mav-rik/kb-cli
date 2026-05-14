@db.table 'chunks'
@db.depth.limit 0
export interface Chunk {
    @meta.id
    id: string

    @db.index.plain 'idx_chunk_doc'
    docId: string

    heading?: string

    headingPath?: string

    headingLevel?: number

    fromLine: number

    toLine: number

    position: number

    contentHash: string

    @db.search.vector 768, 'cosine'
    embedding?: number[]
}
