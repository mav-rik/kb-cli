This project uses `kb` for persistent knowledge management.

Run `kb skill` for full usage instructions.

Key commands: `kb search`, `kb read`, `kb add`, `kb update`, `kb lint`, `kb log`, `kb log add`.

Rules:
- Search before adding, cross-link related docs, sync related knowledge after mutations.
- Discuss key takeaways with user before ingesting new sources.
- Resolve contradictions using recency → authority → specificity.
- Log session summaries after ingest/lint with `kb log add --op <type> --details "..."`.
- Write for chunked retrieval: target ~200-1500 words/doc, ≥80 words per heading, paragraphs <1500 chars. `kb lint` flags retrievability issues (`chunk-merge`, `long-paragraph`, `doc-too-short`, `doc-too-long`); frontmatter opt-outs are `important_sections`, `suppress_merge_warn`, `suppress_lint` — see `kb skill update`.
