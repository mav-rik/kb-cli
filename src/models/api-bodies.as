// HTTP wire-format DTOs for the kb API. Validated by @atscript/moost-validator
// via the global pipe wired in src/api/serve.ts -- any malformed payload
// produces a 400 with the field path before the controller body runs.
//
// Primitive type aliases (WikiName, DocHandle) declare their constraints once
// and propagate via annotation merging when reused as a body field's type.

/** A wiki name - used as PK across the system. Letters, digits, `-`, `_`. */
@expect.minLength 1
@expect.maxLength 64
@expect.pattern '^[a-zA-Z0-9_-]+$'
export type WikiName = string

/** A doc identifier or filename accepted at the API boundary. Accepts the
 *  CLI-style forms (`foo`, `foo.md`, `./foo.md`) - canonicalization happens
 *  downstream in the wiki-ops layer. Empty inputs blocked here. */
@expect.minLength 1
@expect.maxLength 256
export type DocHandle = string

@meta.description 'POST /api/docs - create a new document.'
export interface AddDocBody {
  @meta.required
  title: string

  @meta.required
  category: string

  tags?: string[]

  /** Canonical body field. */
  body?: string
  /** Alias for `body` - legacy CLI parity. */
  content?: string
  /** Alias for `body` - legacy CLI parity. */
  text?: string
  /** Full markdown blob with frontmatter - server parses and merges. */
  raw?: string

  importantSections?: string[]
  suppressMergeWarn?: string[]
  suppressLint?: string[]

  dryRun?: boolean
  wiki?: WikiName
}

@meta.description 'PUT /api/docs/:id - update an existing document. All fields optional; unspecified ones leave the existing value.'
export interface UpdateDocBody {
  title?: string
  category?: string
  tags?: string[]

  body?: string
  content?: string
  text?: string
  raw?: string
  /** Append to existing body instead of replacing. */
  appendBody?: string
  /** Alias for `appendBody`. */
  append?: string

  importantSections?: string[]
  suppressMergeWarn?: string[]
  suppressLint?: string[]

  dryRun?: boolean
  wiki?: WikiName
}

@meta.description 'POST /api/docs/:id/rename - change a doc id. At least one of newId/to/name is required (cross-field check enforced in the handler).'
export interface RenameDocBody {
  newId?: DocHandle
  to?: DocHandle
  name?: DocHandle
  wiki?: WikiName
}

@meta.description 'POST /api/wiki - create a new local wiki.'
export interface CreateWikiBody {
  @meta.required
  name: WikiName
}

@meta.description 'POST /api/log - append an entry to the wiki activity log.'
export interface LogAddBody {
  op?: 'ingest' | 'query' | 'lint' | 'note'
  doc?: DocHandle
  details?: string
  wiki?: WikiName
}
