/**
 * Watchlist name matching.
 *
 * Kept separate from the document stage so it can be tested without pulling
 * in the server-function runtime - this decides whether a case is routed to
 * a human, so it deserves its own coverage.
 */

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Returns the matching watchlist entry, or null.
 *
 * Every token of the entry must appear as a whole token in the holder name.
 * The previous two-way substring test made short entries match almost any
 * traveller: "Ali" flagged "Alistair", and a one-character entry flagged
 * everyone.
 */
export function watchlistMatch(name: string | null | undefined, list: string[]): string | null {
  if (!name) return null;

  const holderTokens = new Set(tokenize(name));
  if (holderTokens.size === 0) return null;

  for (const entry of list) {
    const entryTokens = tokenize(entry);
    if (entryTokens.length === 0) continue;
    if (entryTokens.every((token) => holderTokens.has(token))) return entry;
  }

  return null;
}
