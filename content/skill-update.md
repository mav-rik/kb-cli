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

## Writing for retrieval

Wiki docs are split into chunks by H2/H3 heading. Each chunk is independently searchable, so structure matters.

- **Sections should be substantive.** Aim for at least ~80 words per section. A section with 2-3 lines (e.g. "## Contacts" with just two names) wastes a heading slot and creates a low-quality search hit. If a section is that short, fold it under a sibling heading or remove the heading entirely.
- **Topic sentence first.** Each section's first sentence should restate the topic in plain words. The embedding model anchors on opening tokens. "It uses HTTP 2 internally" retrieves poorly compared to "Service Mesh uses HTTP 2 internally" because the pronoun has no antecedent.
- **Group metadata at the end without standalone headings.** Don't make "## Related", "## See Also", "## Sub-tasks", "## Contacts" their own H2 sections. Either put them under a single `## References` section, or remove the heading and use a horizontal rule + bold label at the bottom.
- **Tags should be specific.** `direct-debit`, `vault`, `sepa` help retrieval. `notes`, `wip`, `internal` do not. 5-10 tags is fine; 20 is too many.
- **Doc length sweet spot: 200-1500 words.** Below 200, the centroid embedding is noisy. Above 1500, split into linked sub-docs (one topic each) rather than one long doc.

**Auto-merging of trivial sections.** Sections with very short bodies (under
~160 chars) or mostly-links bodies get merged into the previous chunk by
default — keeps trivia like "Contacts" or "See Also" from outranking substance.
Three frontmatter fields control retrievability behavior. The first two are
section-scoped (matched case-insensitively against the heading text); the third
is doc-scoped (matched against warning type).

- `important_sections` — *prevents* merging. Use for deliberately short but
  critical sections (e.g. `## TL;DR`, `## Status`).
- `suppress_merge_warn` — silences the chunk-merge warning for those specific
  sections (merge still happens). Use when the merge is fine and you want
  `kb lint` to stop reporting it (e.g. a plain "See Also" link-list).
- `suppress_lint` — silences doc-level soft warnings. Use only with
  justification (e.g. an intentional index page that's legitimately under 200
  words). Never silences structural errors like broken links.

```yaml
important_sections:
  - TL;DR
  - Status
suppress_merge_warn:
  - See Also
  - Contacts
suppress_lint:
  - doc-too-short        # intentional short index/overview
  - doc-too-long         # canonical reference that shouldn't split
  - long-paragraph       # deliberately unbroken transcript / quote
  - chunk-merge          # doc-wide blanket — prefer suppress_merge_warn for specific sections
```

- **Avoid paragraphs over 1500 chars.** The chunker splits oversized sections on
  blank-line paragraph boundaries; a single paragraph beyond the budget cannot
  be subdivided and will be truncated by the 512-token embedding model.

`kb lint` warns about retrievability issues so you can fix them before indexing:
`long-paragraph` (single paragraph over 1500 chars), `doc-too-short` (body under
~200 words; noisy centroid), `doc-too-long` (body over ~1500 words; split into
sub-docs), and `chunk-merge` (section will be auto-merged into the previous
chunk).
