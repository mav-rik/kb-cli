# AI Memory (kb)

This project uses `kb` for persistent knowledge management.

Run `kb skill` for full usage instructions. Run `kb skill ingest` for the ingestion workflow, `kb skill search` for retrieval.

Key commands:
- `kb search "<query>"` — find knowledge
- `kb read <filename>` — read a document
- `kb add --title "..." --category <cat> --tags "..." --content "..."` — store
- `kb update <id> --append "..."` — update
- `kb lint` — check health
- `kb log` — recent activity
- `kb log add --op <type> --details "..."` — record session summary

Rules:
- Search before adding, cross-link related docs, sync related knowledge after mutations.
- Discuss key takeaways with user before ingesting new sources.
- Resolve contradictions using recency → authority → specificity.
- Log session summaries after ingest/lint.
