#!/usr/bin/env node

// Guard for the Cloudflare Workers Builds deploy path.
//
// Why this exists
// ---------------
// `wrangler.json` is tracked in Git and carries a placeholder D1 id
// (`00000000-...`). It is a sample config, NOT a deployable one. The supported
// deploy path is `scripts/write-wrangler-config.mjs` -> `provision-cloudflare`
// -> `wrangler deploy --config wrangler.jsonc`, which produces the untracked
// `wrangler.jsonc` with a real database id.
//
// A bare `npx wrangler deploy` (what Cloudflare Workers Builds runs by default,
// picking up the tracked `wrangler.json`) therefore fails late and opaquely:
//
//   D1 binding 'DB' references database '00000000-...' which was not found.
//   [code: 10181]
//
// That failure lands *after* a full build, so the whole build is wasted. This
// script runs first and fails in seconds with an actionable message.
//
// Usage:
//   node scripts/check-deploy-config.mjs              validate ./wrangler.jsonc
//   node scripts/check-deploy-config.mjs --config X   validate another file
//   node scripts/check-deploy-config.mjs --json       machine-readable output
//
// Exit codes: 0 = ready to deploy, 1 = blocking problems, 2 = script error.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseJsonc, printParseErrorCode } from "jsonc-parser";

import {
  isPlaceholderDatabaseId,
  isPlaceholderPublicUrl,
} from "./provision-cloudflare.mjs";

const argv = process.argv.slice(2);
const hasFlag = (name) => argv.includes(name);
const option = (name, fallback = null) => {
  const index = argv.indexOf(name);
  return index !== -1 && argv[index + 1] ? argv[index + 1] : fallback;
};

/** Create a fresh finding collector. Local per run so tests stay independent. */
function createFindings() {
  const errors = [];
  const warnings = [];
  return {
    errors,
    warnings,
    addError: (code, message, hint) => errors.push({ code, message, hint }),
    addWarning: (code, message, hint) => warnings.push({ code, message, hint }),
  };
}

// ---------------------------------------------------------------- config discovery

/**
 * Prefer the generated `wrangler.jsonc` (real deploy config). Fall back to the
 * tracked `wrangler.json` so the guard still produces a useful diagnosis when
 * the generation step was skipped.
 */
function resolveConfigPath(configArg, addError) {
  if (configArg) {
    const explicit = resolve(configArg);
    if (!existsSync(explicit)) {
      addError("CONFIG_NOT_FOUND", `Config not found: ${configArg}`);
      return null;
    }
    return { path: explicit, generated: true };
  }

  const generated = resolve("wrangler.jsonc");
  if (existsSync(generated)) {
    return { path: generated, generated: true };
  }

  const tracked = resolve("wrangler.json");
  if (existsSync(tracked)) {
    return { path: tracked, generated: false };
  }

  addError(
    "NO_WRANGLER_CONFIG",
    "No wrangler config found in the repository root.",
    "Expected ./wrangler.jsonc (generated) or ./wrangler.json (tracked sample).",
  );
  return null;
}

// ---------------------------------------------------------------- parse

const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";

function parseConfig(path, addError) {
  const raw = readFileSync(path, "utf8");
  const errorsFromParser = [];
  const config = parseJsonc(raw, errorsFromParser, {
    allowTrailingComma: true,
  });
  if (errorsFromParser.length > 0) {
    const first = errorsFromParser[0];
    const detail = printParseErrorCode(first.error);
    addError(
      "CONFIG_PARSE",
      `Cannot parse ${path}: ${detail} (offset ${first.offset}).`,
      "Fix the JSON syntax, or regenerate the config.",
    );
    return null;
  }
  return { config, raw };
}

// ---------------------------------------------------------------- checks

/**
 * Pure check pass over a parsed config. Kept separate from I/O so it can be
 * unit-tested directly.
 *
 * @param {object} config parsed wrangler config
 * @param {boolean} isGenerated whether the config came from wrangler.jsonc
 *   (generated) rather than the tracked wrangler.json sample
 * @param {{addError: Function, addWarning: Function}} sink
 */
export function inspectConfig(config, isGenerated, sink) {
  const { addError, addWarning } = sink;

  // 1) The core failure: a placeholder D1 id.
  const database = config.d1_databases?.[0];
  if (!database) {
    addWarning(
      "NO_D1_BINDING",
      "No d1_databases binding is declared.",
      "If the Worker reads env.DB, it will be undefined at runtime.",
    );
  } else {
    const databaseId = String(database.database_id ?? "").trim();
    if (isPlaceholderDatabaseId(databaseId)) {
      addError(
        "D1_PLACEHOLDER_ID",
        `d1_databases[0].database_id is still a placeholder: ${JSON.stringify(databaseId)}`,
        [
          "Cloudflare will reject the deploy with code 10181 ('database not found').",
          "Generate a deployable config first:",
          "  node ./scripts/write-wrangler-config.mjs   # needs FLAREMO_D1_DATABASE_ID",
          "  pnpm provision:remote                     # creates missing D1/R2/Queue/Vectorize",
          "Then deploy with:  wrangler deploy --config wrangler.jsonc",
        ].join("\n      "),
      );
    }
  }

  if (!config.name) {
    addWarning(
      "NO_NAME",
      "Config has no `name` field.",
      "wrangler needs a Worker name.",
    );
  }

  // 2) Public URL must be a real origin — Better Auth uses it for callbacks.
  const publicUrl = String(config.vars?.FLAREMO_PUBLIC_URL ?? "").trim();
  if (isPlaceholderPublicUrl(publicUrl)) {
    addError(
      "PUBLIC_URL_PLACEHOLDER",
      publicUrl
        ? `vars.FLAREMO_PUBLIC_URL is not a usable public origin: ${publicUrl}`
        : "vars.FLAREMO_PUBLIC_URL is empty.",
      "Set it to your public https origin with no path, e.g. https://notes.yourdomain.com",
    );
  }

  // 3) Vectorize dimension must match the embedding model output.
  const dimensions = Number(config.vars?.FLAREMO_EMBEDDING_DIMENSIONS);
  if (Number.isFinite(dimensions) && dimensions > 0) {
    if (![768, 1024, 1536].includes(dimensions)) {
      addWarning(
        "EMBEDDING_DIMENSIONS_UNUSUAL",
        `FLAREMO_EMBEDDING_DIMENSIONS=${dimensions} is not a common embedding size.`,
        "It must match the Vectorize index dimensions exactly or writes will fail.",
      );
    }
  } else if (config.vars?.FLAREMO_EMBEDDING_PROVIDER === "workers-ai") {
    addWarning(
      "EMBEDDING_DIMENSIONS_MISSING",
      "FLAREMO_EMBEDDING_PROVIDER is workers-ai but FLAREMO_EMBEDDING_DIMENSIONS is not a number.",
      "Semantic search writes will fail. See wrangler.jsonc.example.",
    );
  }

  // 4) Deploying the tracked sample config is the trap this script exists for.
  if (!isGenerated) {
    addError(
      "DEPLOYING_TRACKED_SAMPLE",
      "Resolved to the tracked ./wrangler.json sample, not a generated ./wrangler.jsonc.",
      [
        "This is the root cause of the code 10181 failure seen in CI.",
        "Do not run a bare `wrangler deploy` — it picks up the sample config.",
        "Run `pnpm deploy`, or use --config wrangler.jsonc explicitly.",
      ].join("\n      "),
    );
  }

  // 5) Secrets must never live in the config file.
  return { publicUrl, dimensions };
}

// ---------------------------------------------------------------- entry point

function main() {
  const asJson = hasFlag("--json");
  const useColor = process.stdout.isTTY && !asJson;
  const paint = (code, text) => (useColor ? `${code}${text}${RESET}` : text);

  const { errors, warnings, addError, addWarning } = createFindings();

  const resolved = resolveConfigPath(option("--config"), addError);

  if (resolved) {
    const loaded = parseConfig(resolved.path, addError);
    if (loaded?.config) {
      inspectConfig(loaded.config, resolved.generated, {
        addError,
        addWarning,
      });

      if (
        /"(BETTER_AUTH_SECRET|FLAREMO_BOOTSTRAP_SECRET)"\s*:\s*"[^"]{8,}"/.test(
          loaded.raw,
        )
      ) {
        addError(
          "SECRET_IN_CONFIG",
          "A secret-looking value is hardcoded in the wrangler config.",
          "Move it to `wrangler secret put <NAME>` and remove it from the config.",
        );
      }
    }
  }

  if (asJson) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: errors.length === 0,
          errors,
          warnings,
          config: resolved?.path ?? null,
        },
        null,
        2,
      )}\n`,
    );
    return errors.length === 0 ? 0 : 1;
  }

  console.log("");
  console.log(paint(BOLD, "FlareMo deploy config check"));
  if (resolved) {
    const kind = resolved.generated ? " (generated)" : " (tracked sample)";
    console.log(paint(DIM, `Config: ${resolved.path}${kind}`));
  }
  console.log("");

  const section = (title, items, color, icon) => {
    if (items.length === 0) return;
    console.log(paint(color, `${icon} ${title}`));
    for (const item of items) {
      console.log(`   ${paint(color, item.code)}  ${item.message}`);
      if (item.hint) {
        for (const line of item.hint.split("\n")) {
          console.log(paint(DIM, `      ${line.trim()}`));
        }
      }
    }
    console.log("");
  };

  section("Blocking", errors, RED, "✖");
  section("Advisory", warnings, YELLOW, "⚠");

  if (errors.length > 0) {
    console.log(
      paint(
        RED,
        paint(
          BOLD,
          `Not deployable: ${errors.length} blocking issue(s). Fix them before running wrangler deploy.`,
        ),
      ),
    );
    return 1;
  }

  console.log(paint(GREEN, "✓ Deploy config looks good."));
  return 0;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  try {
    process.exit(main());
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`[ERROR] ${message}`);
    process.exit(2);
  }
}
