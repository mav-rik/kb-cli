# Update Workflow — Modifying Knowledge

Follow these steps when updating, renaming, or reorganizing documents.

## Updating content

**CLI:**
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

**API:**
```
PUT /api/docs/<id>
body: { "append": "\n\n## New Section\n\nNew content here" }

PUT /api/docs/<id>
body: { "content": "complete new content" }

PUT /api/docs/<id>
body: { "title": "Better Title" }

PUT /api/docs/<id>
body: { "category": "new-category" }

PUT /api/docs/<id>
body: { "tags": ["new","tags"] }
```

## After every update (MANDATORY)

Check for docs that might now be outdated:

**CLI:**
```bash
kb related <id>
kb search "<key changed facts>"
```

**API:**
```
GET /api/docs/<id>/related?kb=<name>&limit=10
GET /api/search?q=<key changed facts>&limit=10&kb=<name>
```

Read each related doc. Fix any contradictions:

**CLI:**
```bash
kb update <related-id> --content "corrected content"
```

**API:**
```
PUT /api/docs/<related-id>
body: { "content": "corrected content" }
```

## Renaming

**CLI:**
```bash
kb rename <old-id> <new-id>
```

**API:**
```
POST /api/docs/<old-id>/rename
body: { "newId": "<new-id>" }
```

This automatically:
- Renames the file
- Updates all links across the KB pointing to the old name
- Re-indexes

## Deleting

**CLI:**
```bash
kb delete <id>
```

**API:**
```
DELETE /api/docs/<id>?kb=<name>
```

If other docs linked to it, they'll be warned about broken links. Fix them:

**CLI:**
```bash
kb lint --fix
```

**API:**
```
POST /api/lint/fix?kb=<name>
```

## Reorganizing

Change a doc's category:

**CLI:**
```bash
kb update <id> --category new-category
```

**API:**
```
PUT /api/docs/<id>
body: { "category": "new-category" }
```

Split a large doc: create new smaller docs with portions of the content, add cross-links, then either delete or slim down the original.
