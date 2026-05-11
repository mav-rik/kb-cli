@db.table 'documents'
@db.depth.limit 0
export interface Document {
    @meta.id
    id: string

    @db.index.fulltext 'search', 3
    title: string

    category: string

    @db.json
    tags?: string[]

    @db.index.fulltext 'search', 1
    content: string

    @db.column 'file_path'
    filePath: string

    @db.column 'content_hash'
    contentHash: string

    @db.column 'created_at'
    @db.default.now
    createdAt?: number.timestamp

    @db.column 'updated_at'
    @db.default.now
    updatedAt?: number.timestamp
}
