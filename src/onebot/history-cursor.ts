export const createHistoryCursor = (initialCursor: string | null | undefined, maxPages = 1000) => {
  const seen = new Set<string>(initialCursor == null ? [] : [initialCursor]);
  let pages = 0;

  return {
    advance(cursor: string): boolean {
      pages++;
      if (seen.has(cursor) || pages >= maxPages) return false;
      seen.add(cursor);
      return true;
    },
  };
};
