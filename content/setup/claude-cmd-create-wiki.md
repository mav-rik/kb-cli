Create a new wiki. Ask the user for:
1. Wiki name (lowercase, letters/numbers/dashes/underscores)
2. What this wiki is for (domain, purpose)
3. Any conventions or rules for this wiki

Then execute:

```bash
kb wiki create <name>
kb wiki use <name>
kb schema update --wiki <name>
```

After creating, edit the schema's Custom section with the user's conventions:

```bash
kb schema --wiki <name>
```

Read the schema, then update it by editing `~/.kb/<name>/schema.md` to add the user's domain description and conventions to the `## Custom` section.

Finally, confirm to the user:
- Wiki "<name>" created and set as default
- Schema initialized with their conventions
- Ready to ingest knowledge via `kb add` or `/kb:ingest`
