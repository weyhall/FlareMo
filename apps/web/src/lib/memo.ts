import type { Memo } from "@/api";
import { stripResourceName } from "@/lib/utils";

export function getMemoResourceId(memo: Memo) {
  return stripResourceName(memo.name, "memos");
}

/**
 * Tag syntax mirrors the server-side extractor in
 * `packages/domain/src/tags.ts`. The composer computes `payload.tags` for new
 * memos and the server trusts those values, so both sides must agree on the
 * charset and on what counts as code (issue #152): a `#comment` inside a
 * fenced block or an inline code span is not a tag. Keep the two in sync.
 */
const TAG_PATTERN = /(^|[^\p{L}\p{N}_\-/])#([\p{L}\p{N}_\-/]+)/gu;

export function extractTags(content: string) {
  const tags = new Set<string>();
  for (const match of maskMarkdownLiteralCode(content).matchAll(TAG_PATTERN)) {
    const raw = match[2];
    if (raw) tags.add(raw);
  }
  return [...tags];
}

/**
 * Replace fenced code blocks and inline code spans with spaces (newlines are
 * kept) so tag boundaries match on the prose that remains. Mirrors the
 * literal-segment rules in `packages/domain/src/tags.ts`.
 */
function maskMarkdownLiteralCode(content: string) {
  const masked: string[] = [];
  let inFence = false;
  let fenceChar = "";
  let fenceLength = 0;
  for (const line of content.split(/(?<=\n)/)) {
    if (inFence) {
      masked.push(maskLine(line));
      // Closing fence: same character, at least as long, nothing after it.
      const marker = line.trimEnd().match(/^[ \t]*(~{3,}|`{3,})[ \t]*$/)?.[1];
      if (marker && marker[0] === fenceChar && marker.length >= fenceLength) {
        inFence = false;
        fenceChar = "";
        fenceLength = 0;
      }
      continue;
    }
    const opening = line.match(/^[ \t]*(~{3,}|`{3,})/)?.[1];
    if (opening) {
      inFence = true;
      fenceChar = opening[0] ?? "";
      fenceLength = opening.length;
      masked.push(maskLine(line));
      continue;
    }
    masked.push(maskInlineCode(line));
  }
  return masked.join("");
}

function maskLine(line: string) {
  return line.replace(/[^\n]/g, " ");
}

function maskInlineCode(line: string) {
  let masked = "";
  let cursor = 0;
  let index = 0;
  while (index < line.length) {
    if (line[index] !== "`") {
      index += 1;
      continue;
    }
    let run = 0;
    while (line[index + run] === "`") run += 1;
    const close = line.indexOf("`".repeat(run), index + run);
    if (close === -1) {
      index += run;
      continue;
    }
    masked += maskLine(line.slice(cursor, index));
    masked += maskLine(line.slice(index, close + run));
    cursor = close + run;
    index = cursor;
  }
  return masked + line.slice(cursor);
}

/**
 * Absolute timestamp for a memo. The year is only spelled out when it differs
 * from the current one: imported backfills routinely span many years (issue
 * #143), and two memos from the same month/day in different years used to be
 * indistinguishable in the timeline. Future-dated rows (clock skew, dirty
 * imports) take the same branch, so a future year is never shown year-less.
 */
export function formatMemoTime(value: string, locale?: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat(locale, {
    ...(sameYear ? {} : { year: "numeric" }),
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/**
 * Timeline timestamps read as relative time ("3 hours ago" / "3 小时前")
 * for the past week and fall back to an absolute date beyond that.
 */
export function formatMemoRelativeTime(value: string, locale?: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const absSeconds = Math.abs(diffSeconds);
  if (absSeconds >= 7 * 86_400) return formatMemoTime(value, locale);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (absSeconds < 45) return rtf.format(0, "second");
  if (absSeconds < 3_600)
    return rtf.format(Math.round(diffSeconds / 60), "minute");
  if (absSeconds < 86_400)
    return rtf.format(Math.round(diffSeconds / 3_600), "hour");
  return rtf.format(Math.round(diffSeconds / 86_400), "day");
}
