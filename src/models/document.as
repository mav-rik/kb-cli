@db.table 'documents'
@db.depth.limit 0
export interface Document {
    @meta.id
    id: string

    title: string

    category: string

    @db.json
    tags?: string[]

    @db.column.renamed 'file_path'
    filePath: string

    @db.column.renamed 'content_hash'
    contentHash: string

    @db.column.renamed 'created_at'
    @db.default.now
    createdAt?: number.timestamp

    @db.column.renamed 'updated_at'
    @db.default.now
    updatedAt?: number.timestamp
}
