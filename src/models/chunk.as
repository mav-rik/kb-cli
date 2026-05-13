@db.table 'chunks'
@db.depth.limit 0
export interface Chunk {
    @meta.id
    id: string

    @db.index.plain 'idx_chunk_doc'
    docId: string

    heading?: string

    @db.index.fulltext 'chunk_search', 1
    content: string

    position: number

    contentHash: string
}
