# Update Workflow — Modifying Knowledge

Follow these steps when updating, renaming, or reorganizing documents.

## Updating content

```bash
# Append new information
kb update <id> --append "\n\n## New Section\n\nNew content here"

# Replace entire content
kb update <id> --content "complete new content"

# Change metadata only
kb update <id> --title "Better Title"
kb update <id> --category new-category
kb update <id> --tags "new,tags"
```

## After every update (MANDATORY)

Check for docs that might now be outdated:

```bash
kb related <id>
kb search "<key changed facts>"
```

Read each related doc. If any contradict the updated information, resolve the conflict:

### Conflict resolution

1. **Check recency**: `kb log` — which information is newer?
2. **Check authority**: primary source beats secondary. Official docs beat informal notes.
3. **Check specificity**: concrete claims supersede vague ones.
4. **When clear**: update the stale doc, noting what changed.
5. **When unclear**: flag with "⚠️ Conflicts with [doc](./doc.md)" and ask the user.

```bash
kb update <related-id> --content "corrected content"
```

## Renaming

```bash
kb rename <old-id> <new-id>
```

This automatically:
- Renames the file
- Updates all links across the KB pointing to the old name
- Re-indexes

## Deleting

```bash
kb delete <id>
```

If other docs linked to it, they'll be warned about broken links. Fix them:

```bash
kb lint --fix
```

## Reorganizing

Change a doc's category:

```bash
kb update <id> --category new-category
```

Split a large doc: create new smaller docs with portions of the content, add cross-links, then either delete or slim down the original.
