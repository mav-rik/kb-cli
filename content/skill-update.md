# Update Workflow — Modifying Knowledge

Follow these steps when updating, renaming, or reorganizing documents.

## Updating content

```bash
# Append new information
aimem update <id> --append "\n\n## New Section\n\nNew content here"

# Replace entire content
aimem update <id> --content "complete new content"

# Change metadata only
aimem update <id> --title "Better Title"
aimem update <id> --category new-category
aimem update <id> --tags "new,tags"
```

## After every update (MANDATORY)

Check for docs that might now be outdated:
```bash
aimem related <id>
aimem search "<key changed facts>"
```

Read each related doc. Fix any contradictions:
```bash
aimem update <related-id> --content "corrected content"
```

## Renaming

```bash
aimem rename <old-id> <new-id>
```

This automatically:
- Renames the file
- Updates all links across the KB pointing to the old name
- Re-indexes

## Deleting

```bash
aimem delete <id>
```

If other docs linked to it, they'll be warned about broken links. Fix them:
```bash
aimem lint --fix
```

## Reorganizing

Change a doc's category:
```bash
aimem update <id> --category new-category
```

Split a large doc: create new smaller docs with portions of the content, add cross-links, then either delete or slim down the original.
