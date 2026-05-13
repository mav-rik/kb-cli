@db.table 'links'
@db.depth.limit 0
export interface Link {
    @meta.id
    fromId: string

    @meta.id
    toId: string

    linkText?: string
}
