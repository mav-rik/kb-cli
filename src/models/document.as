@db.table 'documents'
@db.depth.limit 0
export interface Document {
    @meta.id
    id: string

    title: string

    @db.search.filter 'embedding'
    category: string

    @db.json
    tags?: string[]

    filePath: string

    contentHash: string

    @db.default.now
    createdAt?: number.timestamp

    @db.default.now
    updatedAt?: number.timestamp

    @db.search.vector 768, 'cosine'
    embedding?: number[]
}
