Create a new wiki. Ask the user for:
1. Wiki name (lowercase, letters/numbers/dashes/underscores)
2. What this wiki is for (domain, purpose)
3. Any conventions or rules for this wiki

Then execute:

```bash
kb wiki create <name>
```

Ask the user: "Set this wiki as default globally, or just for this project directory?"

- If **globally**: `kb wiki use <name>`
- If **this project**: create/update `kb.config.json` in the current directory with `{ "wiki": "<name>" }`

Then generate the schema:

```bash
kb schema update --wiki <name>
```

Read the generated schema and update `~/.kb/<name>/schema.md` to add the user's domain description and conventions to the `## Custom` section.

Finally, confirm to the user:
- Wiki "<name>" created
- Set as default (globally / for this project)
- Schema initialized with their conventions
- Ready to ingest knowledge via `kb add` or `/kb:ingest`
