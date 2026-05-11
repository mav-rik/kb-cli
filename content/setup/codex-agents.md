# AI Memory (aimem)

This project uses `aimem` for persistent knowledge management.

Run `aimem skill` for full usage instructions. Run `aimem skill ingest` for the ingestion workflow, `aimem skill search` for retrieval.

Key commands:
- `aimem search "<query>"` — find knowledge
- `aimem read <filename>` — read a document
- `aimem add --title "..." --category <cat> --tags "..." --content "..."` — store
- `aimem update <id> --append "..."` — update
- `aimem lint` — check health

Rules: search before adding, cross-link related docs, sync related knowledge after mutations.
