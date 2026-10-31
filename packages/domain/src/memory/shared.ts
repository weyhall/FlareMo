import type {
  MemoryEvidenceRelationType,
  MemoryEvidenceSourceType,
} from "@flaremo/contracts";
import type { FlareMoDb, MemoryItemRow, UserRow } from "@flaremo/db";
import {
  memoryEvents,
  memoryEvidence,
  memoryItems,
  memoryRevisions,
} from "@flaremo/db";
import {
  and,
  desc,
  eq,
  isNotNull,
  isNull,
  like,
  lte,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { createResourceId } from "../ids";

export const MEMORY_MAX_CONTENT_LENGTH = 4_000;

/**
 * Canonical spelling of a fact key: keys like `Project.Database`,
 * `project.database ` and `project_database` describe the same slot and must
 * not split a version chain. Lowercase, whitespace/underscores become dashes,
 * and only letters, digits, dots, dashes and CJK survive.
 */
export function normalizeFactKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\\/\s_]+/g, "-")
    .replace(/[^a-z0-9.\p{Script=Han}-]+/gu, "")
    .replace(/\.{2,}/g, ".")
    .replace(/^[.-]+|[.-]+$/g, "");
}

/**
 * Propose a fact key for a write that arrived without one (§VI.3 key
 * governance). Deliberately conservative:
 *
 * - Episodic entries stay keyless — no key, no supersession, only their own
 *   revision history.
 * - A key is only proposed when the primary topic tag matches the tail of an
 *   *existing* key family in the same scope (`flaremo.database` etc.):
 *   established families are reused so `project.database` / `project.db`
 *   variants converge, but a brand-new family is never coined from a bare tag,
 *   because two true facts sharing a topic must not silently land on one key.
 */
export async function suggestFactKey(
  db: FlareMoDb,
  user: UserRow,
  input: {
    scopeType: MemoryItemRow["scopeType"];
    scopeKey: string | null;
    tags?: string[] | null;
    type: MemoryItemRow["type"];
  },
): Promise<string | null> {
  if (input.type === "episodic") return null;
  const primaryTag = input.tags?.[0];
  const slug = primaryTag ? normalizeFactKey(primaryTag) : "";
  if (!slug) return null;

  const scopeFilter = input.scopeKey
    ? eq(memoryItems.scopeKey, input.scopeKey)
    : isNull(memoryItems.scopeKey);
  const familyRows = await db
    .select({ factKey: memoryItems.factKey })
    .from(memoryItems)
    .where(
      and(
        eq(memoryItems.userId, user.id),
        eq(memoryItems.scopeType, input.scopeType),
        scopeFilter,
        isNotNull(memoryItems.factKey),
        like(memoryItems.factKey, `%${slug}`),
      ),
    )
    .orderBy(desc(memoryItems.updatedAt))
    .limit(20);

  for (const row of familyRows) {
    const key = row.factKey ?? "";
    if (key.split(".").pop() === slug) return key;
  }
  return null;
}

/**
 * The actor behind a memory mutation. Browser sessions are the owner; PATs
 * (MCP clients and scripts) are agents. Agents operate one tier below the
 * user in the verification hierarchy and may never overwrite confirmed or
 * locked memories.
 */
export type MemoryActor = { type: "user" } | { type: "agent"; name: string };

export type MemoryEvidenceInput = {
  sourceType?: string;
  source_type?: string;
  sourceId?: string;
  source_id?: string;
  sourceRevision?: string | null;
  source_revision?: string | null;
  relationType?: string;
  relation_type?: string;
  observedAt?: string | null;
  observed_at?: string | null;
  excerpt?: string | null;
  metadata?: Record<string, unknown>;
};

export type MemoryWriteInput = {
  content: string;
  factKey?: string | null;
  tags?: string[];
  type: MemoryItemRow["type"];
  kind: MemoryItemRow["kind"];
  scopeType: MemoryItemRow["scopeType"];
  scopeKey: string | null;
  tier: MemoryItemRow["tier"];
  importance: number;
  confidence: number;
  verification?: MemoryItemRow["verification"];
  sourceAgent?: string | null;
  sourceSession?: string | null;
  sourceRef?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  observedAt?: string | null;
  expiresAt?: string | null;
  idempotencyKey?: string | null;
  evidence?: MemoryEvidenceInput[];
};

function normalizeMemoryContent(content: string) {
  return content.trim().replace(/\s+/g, " ");
}

function assertMemoryContentLength(content: string) {
  if (content.length > MEMORY_MAX_CONTENT_LENGTH) {
    throw new ValidationError(
      "Memory content must be 4000 characters or fewer; store long-form content as a memo instead.",
    );
  }
}

/**
 * Reject obvious credential material at write time. This is a high-confidence
 * rule list, not a parser: P0 blocks the clearly dangerous shapes and lets the
 * user's review flow catch subtler secrets.
 */
function assertNoSecrets(content: string) {
  const lowered = content.toLowerCase();
  const markers = [
    "authorization:",
    "authorization bearer",
    "memos_pat_",
    "-----begin rsa private key-----",
    "-----begin private key-----",
    "-----begin pgp private key-----",
    "cookie:",
    "set-cookie:",
    "api_key=",
    "apikey=",
    "client_secret=",
    "password=",
    "passwd=",
  ];
  if (markers.some((marker) => lowered.includes(marker))) {
    throw new ValidationError("MEMORY_SECRET_REJECTED");
  }
}

export async function computeFingerprint(
  user: UserRow,
  content: string,
  type: string,
  kind: string,
  scopeType: string,
  scopeKey: string | null,
) {
  const canonical = [
    user.id,
    type,
    kind,
    scopeType,
    scopeKey ?? "",
    content,
  ].join("\u001f");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function resolveVerificationForActor(
  actor: MemoryActor,
  input: MemoryWriteInput,
): MemoryItemRow["verification"] {
  if (actor.type === "user") {
    // The web UI only exposes "create" and "lock at create"; both are user
    // affirmations and therefore confirmed or locked.
    return input.verification === "locked" ? "locked" : "confirmed";
  }
  if (input.verification === "locked" || input.verification === "confirmed") {
    throw new ForbiddenError("Agents cannot lock or confirm memories.");
  }
  return input.verification ?? "observed";
}

export function resolveConfidenceForActor(
  actor: MemoryActor,
  input: MemoryWriteInput,
) {
  if (actor.type === "user") return 100;
  return input.confidence;
}

export async function requireMemory(
  db: FlareMoDb,
  user: UserRow,
  id: string,
): Promise<MemoryItemRow> {
  const row = await db
    .select()
    .from(memoryItems)
    .where(and(eq(memoryItems.id, id), eq(memoryItems.userId, user.id)))
    .get();
  if (!row) throw new NotFoundError(`Memory not found: ${id}`);
  return row;
}

export function assertAgentCanMutate(actor: MemoryActor, row: MemoryItemRow) {
  if (actor.type !== "agent") return;
  if (row.verification === "locked") {
    throw new ForbiddenError(
      "Agents cannot modify a locked memory; propose a conflict instead.",
    );
  }
  if (row.verification === "confirmed") {
    throw new ForbiddenError(
      "Agents cannot modify a confirmed memory; propose a conflict instead.",
    );
  }
}

export async function appendRevision(
  db: FlareMoDb,
  user: UserRow,
  row: MemoryItemRow,
  createdByType: "user" | "agent",
  createdByAgent?: string | null,
) {
  const snapshot: Record<string, unknown> = {
    type: row.type,
    kind: row.kind,
    scope_type: row.scopeType,
    scope_key: row.scopeKey,
    fact_key: row.factKey,
    tags: row.tags,
    tier: row.tier,
    verification: row.verification,
    status: row.status,
    importance: row.importance,
    confidence: row.confidence,
    valid_from: row.validFrom,
    valid_to: row.validTo,
  };
  await db.insert(memoryRevisions).values({
    id: createResourceId("memories"),
    memoryId: row.id,
    userId: user.id,
    content: row.content,
    metadataSnapshot: snapshot,
    createdByType,
    createdByAgent: createdByAgent ?? null,
    createdAt: new Date().toISOString(),
  });
}

/**
 * The single definition of "this memory is live and answerable right now".
 *
 * Kept in one place because three readers (recall, bootstrap, compile) must
 * agree — a drift here means the same memory is visible in one surface and
 * invisible in another. `asOf` lets a caller ask the same question about a past
 * instant for time-travel reads.
 */
export function memoryLivenessCondition(asOf: string): SQL {
  return and(
    or(isNull(memoryItems.validFrom), lte(memoryItems.validFrom, asOf)),
    or(isNull(memoryItems.validTo), sql`${memoryItems.validTo} > ${asOf}`),
    // `expires_at` is a soft self-destruct for memories that are only useful for
    // a while (a temporary workaround, a soon-obsolete dependency pin). It never
    // changes `status`; an expired row simply stops being answered.
    or(isNull(memoryItems.expiresAt), sql`${memoryItems.expiresAt} > ${asOf}`),
  ) as SQL;
}

export async function appendMemoryEvent(
  db: FlareMoDb,
  userId: string,
  memoryId: string,
  eventType: MemoryEventType,
  actorType: "user" | "agent",
  actorName?: string | null,
  metadata?: Record<string, unknown>,
) {
  await memoryEventStatement(
    db,
    userId,
    memoryId,
    eventType,
    actorType,
    actorName,
    metadata,
  );
}

export type MemoryEventType =
  | "created"
  | "confirmed"
  | "locked"
  | "unlocked"
  | "challenged"
  | "superseded"
  | "archived"
  | "restored";

/**
 * Prepared sibling of {@link appendMemoryEvent} for sweeps that write many
 * events at once: the caller collects statements and flushes them in one
 * `db.batch` instead of paying a round trip per row.
 */
export function memoryEventStatement(
  db: FlareMoDb,
  userId: string,
  memoryId: string,
  eventType: MemoryEventType,
  actorType: "user" | "agent",
  actorName?: string | null,
  metadata?: Record<string, unknown>,
  createdAt?: string,
) {
  return db.insert(memoryEvents).values({
    id: createResourceId("memories"),
    userId,
    memoryId,
    eventType,
    actorType,
    actorName: actorName ?? null,
    metadata: metadata ?? {},
    createdAt: createdAt ?? new Date().toISOString(),
  });
}

export async function insertMemoryEvidence(
  db: FlareMoDb,
  userId: string,
  memoryId: string,
  evidence: MemoryEvidenceInput,
) {
  let excerptHash: string | null = null;
  if (evidence.excerpt) {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(evidence.excerpt),
    );
    excerptHash = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  const sourceType = (evidence.sourceType ??
    evidence.source_type ??
    "manual") as MemoryEvidenceSourceType;
  const sourceId =
    evidence.sourceId ?? evidence.source_id ?? createResourceId("memories");
  const sourceRevision =
    evidence.sourceRevision ?? evidence.source_revision ?? null;
  const relationType = (evidence.relationType ??
    evidence.relation_type ??
    "derived_from") as MemoryEvidenceRelationType;
  const observedAt =
    evidence.observedAt ?? evidence.observed_at ?? new Date().toISOString();

  await db.insert(memoryEvidence).values({
    id: createResourceId("memories"),
    memoryId,
    userId,
    sourceType,
    sourceId,
    sourceRevision,
    relationType,
    observedAt,
    excerpt: evidence.excerpt ?? null,
    excerptHash,
    metadata: evidence.metadata ?? {},
    createdAt: new Date().toISOString(),
  });
}

export { assertMemoryContentLength, assertNoSecrets, normalizeMemoryContent };

export function buildFtsCondition(content: string) {
  const trimmed = content.trim();
  if (!trimmed) return undefined;
  const tokens = trimmed.match(/[\p{L}\p{N}_-]+/gu) ?? [];
  // Trigram FTS5 cannot match queries shorter than three characters, so a
  // short or token-less query falls back to a plain LIKE substring match.
  const trigrams = tokens.filter((token) => [...token].length >= 3);
  if (trigrams.length === 0) {
    return sql`${memoryItems.content} LIKE ${`%${escapeLike(trimmed)}%`} ESCAPE '\\'`;
  }
  const match = trigrams
    .map((token) => `"${token.replaceAll('"', '""')}"`)
    .join(" OR ");
  return sql`${memoryItems.id} IN (
    SELECT memory_id FROM memory_fts WHERE memory_fts MATCH ${match}
  )`;
}

/**
 * Keyword candidates ordered by FTS5 relevance (bm25 via the built-in `rank`
 * column), not by recency. The RRF keyword channel feeds ranks into the
 * fusion formula, so ordering by `updatedAt` would silently turn the keyword
 * path into a "most recent wins" channel (§VI.6). Returns null when the
 * query has no usable trigram tokens; the caller then falls back.
 */
export async function searchFtsRanked(
  db: FlareMoDb,
  query: string,
  limit: number,
): Promise<Array<{ memoryId: string; rank: number }>> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const tokens = trimmed.match(/[\p{L}\p{N}_-]+/gu) ?? [];
  const trigrams = tokens.filter((token) => [...token].length >= 3);
  if (trigrams.length === 0) return [];

  const match = trigrams
    .map((token) => `"${token.replaceAll('"', '""')}"`)
    .join(" OR ");
  const rows = await db.all<{ memory_id: string }>(sql`
    SELECT memory_id FROM memory_fts
    WHERE memory_fts MATCH ${match}
    ORDER BY rank
    LIMIT ${limit}
  `);
  return rows.map((row, index) => ({
    memoryId: row.memory_id,
    rank: index + 1,
  }));
}

function escapeLike(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}
