@db.table 'chunks'
@db.depth.limit 0
export interface Chunk {
    @meta.id
    id: string

    @db.column.renamed 'doc_id'
    @db.index.plain 'idx_chunk_doc'
    docId: string

    heading?: string

    @db.index.fulltext 'chunk_search', 1
    content: string

    position: number

    @db.column.renamed 'content_hash'
    contentHash: string
}
