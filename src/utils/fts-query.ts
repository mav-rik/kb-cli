/**
 * Build an FTS5 MATCH expression from a natural-language query.
 *
 * The raw query is split on whitespace and punctuation, then each token is
 * wrapped in double-quotes and joined with `OR`. This gives BM25 the freedom
 * to rank partial-match docs sensibly — a doc hitting 2 of 3 query tokens
 * still appears, just lower than a doc hitting all 3.
 *
 * Without this rewrite, FTS5's default implicit-AND would drop any doc that
 * doesn't literally contain every query token. Natural-language queries like
 * "vault credentials rotation" would miss the obvious match (a doc that
 * covers vault credentials but uses "refresh" instead of "rotation").
 */
export function buildFtsQuery(query: string): string {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter(Boolean)
    .map((t) => `"${t}"`)
  return tokens.join(' OR ')
}
