/**
 * D1 caps a single statement at 100 bound parameters — not the 999 SQLite
 * allows, and Miniflare enforces the same ceiling, so a chunk that only works
 * locally does not exist. Every bulk `inArray`/multi-row `values` must be
 * sized as `floor(limit / columns)` rather than picked by row count, because
 * a 4-column insert only fits 25 rows.
 */
export const D1_MAX_BOUND_PARAMETERS = 100;

/**
 * Rows per bulk statement for a table with `columnCount` columns. The reserve
 * leaves room for the fixed bindings a statement usually carries on top of
 * its row values (a user id, a scope predicate, a status).
 */
export function d1RowsPerStatement(columnCount: number, reserve = 10): number {
  const usable = D1_MAX_BOUND_PARAMETERS - reserve;
  return Math.max(1, Math.floor(usable / Math.max(1, columnCount)));
}

/** Ids per `inArray(...)` — account for any extra fixed bindings via reserve. */
export function d1IdsPerStatement(reserve = 10): number {
  return Math.max(1, D1_MAX_BOUND_PARAMETERS - reserve);
}

/** Splits a list into batches small enough for one D1 statement each. */
export function chunkForD1<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size) {
    chunks.push(items.slice(offset, offset + size));
  }
  return chunks;
}
