@db.table 'links'
@db.depth.limit 0
export interface Link {
    @meta.id
    @db.column 'from_id'
    fromId: string

    @meta.id
    @db.column 'to_id'
    toId: string

    @db.column 'link_text'
    linkText?: string
}
