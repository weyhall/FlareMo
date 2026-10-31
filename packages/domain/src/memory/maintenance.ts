import type { FlareMoDb } from "@flaremo/db";
import {
  memoryCompileArchives,
  memoryEvidence,
  memoryItems,
  memoryRevisions,
  memos,
} from "@flaremo/db";
import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { insertEmbeddingTask } from "../embedding-outbox";
import { createResourceId } from "../ids";
import { memoryEventStatement } from "./shared";

/**
 * Daily memory-ledger upkeep, driven by the shared maintenance cron.
 *
 * Five rules from the design need a clock rather than a request:
 *   1. An unanswered conjecture is noise, not knowledge — it expires (§IV.5.2).
 *   2. A memory whose validity window has ended must leave the vector index, or
 *      recall keeps paying to rank rows it will always filter out (§VI.5).
 *   3. The same is true once `expires_at` passes.
 *   4. Evidence whose source changed or vanished must be flagged (§VI.1) —
 *      hash comparison against the current source text.
 *   5. Injection archives grow without bound; keep a bounded tail.
 *
 * Everything here is idempotent: it re-derives state from timestamps, so a
 * missed or repeated run converges on the same result.
 */

/** Conjectures the user has not acted on within this window are retired. */
export const INFERRED_PROPOSAL_TTL_DAYS = 14;
/** Cap per run so a backlog drains over days instead of in one cron spike. */
const MAINTENANCE_BATCH = 200;
/** Archives kept per user; older ones are pruned by the daily sweep. */
const COMPILE_ARCHIVE_RETENTION = 200;

/** Archive cap per sweep before flushing one `db.batch`. */
const MAINTENANCE_STATEMENT_BATCH = 50;

/**
 * Flush prepared maintenance statements in slices. These sweeps run on a daily
 * cron over up to 200 rows, and issuing one awaited statement per row turned
 * each into hundreds of serial D1 round trips.
 */
async function flushMaintenanceStatements(
  db: FlareMoDb,
  statements: unknown[],
): Promise<void> {
  for (
    let offset = 0;
    offset < statements.length;
    offset += MAINTENANCE_STATEMENT_BATCH
  ) {
    await db.batch(
      statements.slice(
        offset,
        offset + MAINTENANCE_STATEMENT_BATCH,
      ) as unknown as Parameters<FlareMoDb["batch"]>[0],
    );
  }
}

export async function expireStaleInferredProposals(
  db: FlareMoDb,
  now = new Date(),
  limit = MAINTENANCE_BATCH,
): Promise<number> {
  const cutoff = new Date(
    now.getTime() - INFERRED_PROPOSAL_TTL_DAYS * 86_400_000,
  ).toISOString();

  const stale = await db
    .select({ id: memoryItems.id, userId: memoryItems.userId })
    .from(memoryItems)
    .where(
      and(
        eq(memoryItems.verification, "inferred"),
        eq(memoryItems.status, "active"),
        eq(memoryItems.needsReview, true),
        lt(memoryItems.createdAt, cutoff),
      ),
    )
    .limit(limit);

  if (stale.length === 0) return 0;
  const nowIso = now.toISOString();

  const statements: unknown[] = [];
  for (const row of stale) {
    statements.push(
      db
        .update(memoryItems)
        .set({
          status: "archived",
          needsReview: false,
          reviewReason: "expired",
          updatedAt: nowIso,
        })
        .where(
          and(eq(memoryItems.id, row.id), eq(memoryItems.userId, row.userId)),
        ),
      memoryEventStatement(
        db,
        row.userId,
        row.id,
        "archived",
        "agent",
        "maintenance",
        { reason: "inferred_expired", ttl_days: INFERRED_PROPOSAL_TTL_DAYS },
        nowIso,
      ),
    );
  }
  await flushMaintenanceStatements(db, statements);
  return stale.length;
}

/**
 * Queue vector cleanup for memories that have left the answerable set but still
 * have an index entry: superseded, archived, expired, or past their window.
 * Deletion is queued (not executed inline) so the outbox owns index mutations,
 * matching every other embedding write in the codebase.
 */
export async function reclaimStaleMemoryVectors(
  db: FlareMoDb,
  now = new Date(),
  limit = MAINTENANCE_BATCH,
): Promise<number> {
  const nowIso = now.toISOString();

  const stale = await db
    .select({ id: memoryItems.id, userId: memoryItems.userId })
    .from(memoryItems)
    .where(
      and(
        // Only rows that were indexed at some point need reclaiming.
        or(
          eq(memoryItems.embeddingStatus, "indexed"),
          eq(memoryItems.embeddingStatus, "pending"),
          eq(memoryItems.embeddingStatus, "error"),
        ),
        or(
          // Governance states other than superseded leave the answerable set
          // immediately.
          inArray(memoryItems.status, ["archived", "disputed", "deleted"]),
          // A superseded version is still the live rule until its successor's
          // valid_from arrives (§VI.4, §九.18): its vector must survive until
          // then, which is why status alone is not enough here.
          and(
            eq(memoryItems.status, "superseded"),
            or(isNull(memoryItems.validTo), lte(memoryItems.validTo, nowIso)),
          ),
          // An active row can still be out of the answerable set: its window
          // has closed, or it carries an expiry that has passed.
          and(
            eq(memoryItems.status, "active"),
            or(
              and(
                isNotNull(memoryItems.validTo),
                lte(memoryItems.validTo, nowIso),
              ),
              and(
                isNotNull(memoryItems.expiresAt),
                lte(memoryItems.expiresAt, nowIso),
              ),
            ),
          ),
        ),
      ),
    )
    .limit(limit);

  let queued = 0;
  const statements: unknown[] = [];
  for (const row of stale) {
    statements.push(
      insertEmbeddingTask(db, {
        userId: row.userId,
        resourceType: "memory",
        resourceId: row.id,
        operation: "delete",
        createdAt: nowIso,
      }),
      db
        .update(memoryItems)
        .set({ embeddingStatus: "not_indexed", updatedAt: nowIso })
        .where(
          and(eq(memoryItems.id, row.id), eq(memoryItems.userId, row.userId)),
        ),
    );
    queued += 1;
  }
  await flushMaintenanceStatements(db, statements);
  return queued;
}

/** Convenience wrapper used by the worker's daily maintenance run. */
export async function runMemoryLedgerMaintenance(
  db: FlareMoDb,
  now = new Date(),
): Promise<{
  expiredProposals: number;
  reclaimedVectors: number;
  staleEvidence: number;
  missingEvidence: number;
  prunedArchives: number;
  sunkMemories: number;
  foldedRevisions: number;
}> {
  const expiredProposals = await expireStaleInferredProposals(db, now);
  const reclaimedVectors = await reclaimStaleMemoryVectors(db, now);
  const evidence = await checkEvidenceStaleness(db, now);
  const prunedArchives = await pruneCompileArchives(db, now);
  const sunkMemories = await sinkDormantObservedMemories(db, now);
  const foldedRevisions = await foldOldRevisions(db, now);
  return {
    expiredProposals,
    reclaimedVectors,
    staleEvidence: evidence.stale,
    missingEvidence: evidence.missing,
    prunedArchives,
    sunkMemories,
    foldedRevisions,
  };
}

/**
 * Evidence staleness sweep (§VI.1). Memo-backed evidence quotes the source at
 * write time; the sweep re-reads the current memo text:
 *
 * - memo gone → 【依据缺失】: `missing_at`, and the memory re-enters the
 *   review inbox for the human to re-take or retire it.
 * - the quoted excerpt no longer appears verbatim in the memo →
 *   【依据已变更】: `stale_at` badge only.
 *
 * Neither flag is cleared automatically — only fresh evidence or retirement
 * resolves them, so an unflagged row is always a true statement about the
 * source. `excerpt_hash` cannot be re-hashed against the *whole* memo (an
 * excerpt is a fragment), so presence-of-excerpt is the comparison the hash
 * anchors; non-memo sources have no authoritative local text and are skipped.
 */
export async function checkEvidenceStaleness(
  db: FlareMoDb,
  now = new Date(),
  limit = MAINTENANCE_BATCH,
): Promise<{ stale: number; missing: number }> {
  const rows = await db
    .select({
      id: memoryEvidence.id,
      memoryId: memoryEvidence.memoryId,
      userId: memoryEvidence.userId,
      sourceId: memoryEvidence.sourceId,
      excerpt: memoryEvidence.excerpt,
    })
    .from(memoryEvidence)
    .where(
      and(
        eq(memoryEvidence.sourceType, "memo"),
        isNull(memoryEvidence.staleAt),
        isNull(memoryEvidence.missingAt),
      ),
    )
    .limit(limit);

  const nowIso = now.toISOString();
  let stale = 0;
  let missing = 0;
  const statements: unknown[] = [];

  const sourceIds = Array.from(new Set(rows.map((r) => r.sourceId)));
  const memoMap = new Map<string, string>();
  if (sourceIds.length > 0) {
    for (let offset = 0; offset < sourceIds.length; offset += 100) {
      const chunk = sourceIds.slice(offset, offset + 100);
      const memoRows = await db
        .select({ id: memos.id, content: memos.content })
        .from(memos)
        .where(inArray(memos.id, chunk));
      for (const memo of memoRows) memoMap.set(memo.id, memo.content);
    }
  }

  for (const row of rows) {
    const currentContent = memoMap.get(row.sourceId);
    if (!currentContent) {
      // Source vanished: badge the evidence and push the memory back into
      // the review inbox — only the human can re-take or retire it.
      statements.push(
        db
          .update(memoryEvidence)
          .set({ missingAt: nowIso })
          .where(eq(memoryEvidence.id, row.id)),
        db
          .update(memoryItems)
          .set({
            needsReview: true,
            reviewReason: "evidence_stale",
            updatedAt: nowIso,
          })
          .where(eq(memoryItems.id, row.memoryId)),
        memoryEventStatement(
          db,
          row.userId,
          row.memoryId,
          "challenged",
          "agent",
          "maintenance",
          { evidence_id: row.id, reason: "evidence_missing" },
          nowIso,
        ),
      );
      missing += 1;
      continue;
    }

    const excerpt = row.excerpt ?? "";
    const stillQuoted = excerpt.length > 0 && currentContent.includes(excerpt);
    if (!stillQuoted) {
      // The quoted basis no longer appears verbatim: the source was changed.
      // Badge only — this is informational, not a review-inbox event.
      statements.push(
        db
          .update(memoryEvidence)
          .set({ staleAt: nowIso })
          .where(eq(memoryEvidence.id, row.id)),
      );
      stale += 1;
    }
  }
  await flushMaintenanceStatements(db, statements);

  return { stale, missing };
}

/** Bounded tail of injection archives per user (§VI.12). */
export async function pruneCompileArchives(
  db: FlareMoDb,
  _now = new Date(),
  limit = MAINTENANCE_BATCH,
): Promise<number> {
  const owners = await db
    .select({ userId: memoryItems.userId })
    .from(memoryItems)
    .groupBy(memoryItems.userId)
    .limit(200);

  // One grouped count instead of a count query per owner.
  const totals = new Map<string, number>();
  const counts = await db
    .select({
      userId: memoryCompileArchives.userId,
      n: sql<number>`count(*)`.mapWith(Number),
    })
    .from(memoryCompileArchives)
    .groupBy(memoryCompileArchives.userId);
  for (const row of counts) totals.set(row.userId, row.n);

  let pruned = 0;
  const statements: unknown[] = [];
  for (const owner of owners) {
    const total = totals.get(owner.userId) ?? 0;
    if (total <= COMPILE_ARCHIVE_RETENTION) continue;

    const excess = total - COMPILE_ARCHIVE_RETENTION;
    const stalest = await db
      .select({ id: memoryCompileArchives.id })
      .from(memoryCompileArchives)
      .where(eq(memoryCompileArchives.userId, owner.userId))
      .orderBy(memoryCompileArchives.createdAt)
      .limit(Math.min(excess, limit));
    if (stalest.length === 0) continue;
    statements.push(
      db.delete(memoryCompileArchives).where(
        inArray(
          memoryCompileArchives.id,
          stalest.map((row) => row.id),
        ),
      ),
    );
    pruned += stalest.length;
  }
  await flushMaintenanceStatements(db, statements);
  return pruned;
}

/**
 * Natural sink for AI assets (§IV.5.4). Observations nobody has recalled for
 * the dormancy window quietly archive; human-endorsed assets never sink.
 * Recency comes from recall's access bookkeeping (last_accessed_at), with
 * creation time as the fallback clock.
 */
export const OBSERVED_DORMANCY_DAYS = 90;

export async function sinkDormantObservedMemories(
  db: FlareMoDb,
  now = new Date(),
  limit = MAINTENANCE_BATCH,
): Promise<number> {
  const nowIso = now.toISOString();
  const cutoff = new Date(
    now.getTime() - OBSERVED_DORMANCY_DAYS * 86_400_000,
  ).toISOString();

  const dormant = await db
    .select({ id: memoryItems.id, userId: memoryItems.userId })
    .from(memoryItems)
    .where(
      and(
        eq(memoryItems.status, "active"),
        eq(memoryItems.verification, "observed"),
        eq(memoryItems.needsReview, false),
        // Never recalled: fall back to creation time for the dormancy clock.
        or(
          and(
            isNotNull(memoryItems.lastAccessedAt),
            lt(memoryItems.lastAccessedAt, cutoff),
          ),
          and(
            isNull(memoryItems.lastAccessedAt),
            lt(memoryItems.createdAt, cutoff),
          ),
        ),
      ),
    )
    .limit(limit);

  const statements: unknown[] = [];
  for (const row of dormant) {
    statements.push(
      db
        .update(memoryItems)
        .set({
          status: "archived",
          updatedAt: nowIso,
        })
        .where(
          and(eq(memoryItems.id, row.id), eq(memoryItems.userId, row.userId)),
        ),
      memoryEventStatement(
        db,
        row.userId,
        row.id,
        "archived",
        "agent",
        "maintenance",
        {
          reason: "dormancy_sink",
          dormancy_days: OBSERVED_DORMANCY_DAYS,
        },
        nowIso,
      ),
      insertEmbeddingTask(db, {
        userId: row.userId,
        resourceType: "memory",
        resourceId: row.id,
        operation: "delete",
        createdAt: nowIso,
      }),
    );
  }
  await flushMaintenanceStatements(db, statements);
  return dormant.length;
}

/**
 * Revision folding (§VI.12): a note with more than REVISION_FOLD_THRESHOLD
 * revisions collapses its oldest history into one milestone snapshot, keeping
 * the newest threshold intact. The milestone preserves what the *oldest*
 * version said and how many entries were folded, so "历史不丢失" holds at a
 * milestone granularity without unbounded growth.
 */
export const REVISION_FOLD_THRESHOLD = 50;

export async function foldOldRevisions(
  db: FlareMoDb,
  _now = new Date(),
  limit = MAINTENANCE_BATCH,
): Promise<number> {
  const crowded = await db
    .select({
      memoryId: memoryRevisions.memoryId,
      userId: memoryRevisions.userId,
      total: sql<number>`count(*)`,
    })
    .from(memoryRevisions)
    .groupBy(memoryRevisions.memoryId, memoryRevisions.userId)
    .having(sql`count(*) > ${REVISION_FOLD_THRESHOLD}`)
    .limit(limit);

  let folded = 0;
  const statements: unknown[] = [];
  for (const group of crowded) {
    // Only the oldest `excess` rows are folded, so read that many rather than
    // the memory's entire revision history.
    const excess = group.total - REVISION_FOLD_THRESHOLD;
    if (excess <= 0) continue;
    const toFold = await db
      .select()
      .from(memoryRevisions)
      .where(eq(memoryRevisions.memoryId, group.memoryId))
      .orderBy(memoryRevisions.createdAt)
      .limit(excess);
    const oldest = toFold[0];
    if (!oldest) continue;
    // One milestone snapshot replaces the folded tail: the oldest revision's
    // content, stamped as a maintenance milestone. The insert and the delete
    // go into the same batch so a partial run cannot drop history.
    statements.push(
      db.insert(memoryRevisions).values({
        id: createResourceId("memories"),
        memoryId: group.memoryId,
        userId: group.userId,
        content: oldest.content,
        metadataSnapshot: {
          milestone: true,
          folded_count: toFold.length,
          folded_span: {
            from: oldest.createdAt,
            to: toFold[toFold.length - 1]?.createdAt ?? oldest.createdAt,
          },
        },
        createdByType: "agent",
        createdByAgent: "maintenance",
        createdAt: oldest.createdAt,
      }),
      db.delete(memoryRevisions).where(
        inArray(
          memoryRevisions.id,
          toFold.map((row) => row.id),
        ),
      ),
    );
    folded += toFold.length;
  }
  await flushMaintenanceStatements(db, statements);
  return folded;
}
