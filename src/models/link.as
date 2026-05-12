@db.table 'links'
@db.depth.limit 0
export interface Link {
    @meta.id
    @db.column.renamed 'from_id'
    fromId: string

    @meta.id
    @db.column.renamed 'to_id'
    toId: string

    @db.column.renamed 'link_text'
    linkText?: string
}
