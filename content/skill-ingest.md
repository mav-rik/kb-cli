# Ingest Workflow — Storing New Knowledge

Follow these steps exactly when storing new information.

## Step 1: Search for existing knowledge

```bash
aimem search "<key concepts from the new information>"
```

If a highly relevant doc exists (score > 0.03), go to Step 2a. Otherwise Step 2b.

## Step 2a: Update existing document

```bash
aimem read <filename>
```

Review the existing content. Then either:
- Append new info: `aimem update <id> --append "\n\n## New Section\n\ncontent..."`
- Replace with merged content: `aimem update <id> --content "full merged content"`

## Step 2b: Create new document

Choose a descriptive, specific title. Check existing categories:
```bash
aimem categories
```

Create the document:
```bash
aimem add --title "Descriptive Title" --category <category> --tags "tag1,tag2" --content "content with [links](./related-doc.md)"
```

For large content, use `--file <path>` or pipe via `--stdin`.

## Step 3: Add cross-links

Search for related docs:
```bash
aimem related <new-doc-id>
```

For each related doc, consider adding a link FROM it to the new doc:
```bash
aimem update <related-id> --append "\n\nSee also: [New Doc Title](./new-doc-id.md)"
```

## Step 4: Sync related knowledge (MANDATORY)

Search for docs that might now contain outdated or contradictory information:
```bash
aimem search "<key facts from new content>"
```

Read each result. If any contain stale info:
```bash
aimem update <id> --content "corrected content"
```

## Step 5: Verify

```bash
aimem lint
```

Should report no broken links or drift.

## Guidelines

- **Title**: specific and descriptive ("React Query Caching Strategy" not "Notes")
- **Category**: reuse existing categories; create new only if nothing fits
- **Tags**: 2-5 short keywords for discoverability
- **Size**: target 50-200 lines per doc; split if larger
- **Links**: add `[Display Text](./filename.md)` for every related concept
