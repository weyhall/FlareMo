import assert from "node:assert/strict";
import test from "node:test";

import { inspectConfig } from "./check-deploy-config.mjs";

/** Run inspectConfig with a fresh collector and index the findings by code. */
function run(config, isGenerated = true) {
  const errors = [];
  const warnings = [];
  inspectConfig(config, isGenerated, {
    addError: (code, message, hint) => errors.push({ code, message, hint }),
    addWarning: (code, message, hint) => warnings.push({ code, message, hint }),
  });
  return {
    errors,
    warnings,
    errorCodes: errors.map((item) => item.code),
    warningCodes: warnings.map((item) => item.code),
  };
}

const VALID = {
  name: "flaremo",
  d1_databases: [
    {
      binding: "DB",
      database_name: "flaremo",
      database_id: "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
    },
  ],
  vars: {
    FLAREMO_PUBLIC_URL: "https://notes.mycompany.com",
    FLAREMO_EMBEDDING_PROVIDER: "workers-ai",
    FLAREMO_EMBEDDING_DIMENSIONS: "1024",
  },
};

test("accepts a fully generated deploy config", () => {
  const result = run(VALID, true);
  assert.deepEqual(result.errorCodes, []);
});

test("flags the zero-uuid D1 id that breaks wrangler deploy", () => {
  const result = run(
    {
      ...VALID,
      d1_databases: [
        {
          binding: "DB",
          database_name: "flaremo",
          database_id: "00000000-0000-0000-0000-000000000000",
        },
      ],
    },
    true,
  );
  assert.ok(result.errorCodes.includes("D1_PLACEHOLDER_ID"));
  const finding = result.errors.find(
    (item) => item.code === "D1_PLACEHOLDER_ID",
  );
  assert.match(finding.message, /00000000-0000-0000-0000-000000000000/);
  assert.match(
    finding.hint,
    /10181/,
    "hint should name the Cloudflare error code",
  );
  assert.match(
    finding.hint,
    /write-wrangler-config/,
    "hint should point at the generator",
  );
});

test("flags the template D1 placeholder too", () => {
  const result = run(
    {
      ...VALID,
      d1_databases: [
        {
          binding: "DB",
          database_name: "flaremo",
          database_id: "REPLACE_WITH_YOUR_D1_DATABASE_ID",
        },
      ],
    },
    true,
  );
  assert.ok(result.errorCodes.includes("D1_PLACEHOLDER_ID"));
});

test("rejects deploying the tracked sample config", () => {
  const result = run(VALID, false);
  assert.ok(result.errorCodes.includes("DEPLOYING_TRACKED_SAMPLE"));
});

test("rejects a placeholder or empty public URL", () => {
  for (const url of [
    "",
    "https://flaremo.example.workers.dev",
    "http://notes.mycompany.com",
    "https://notes.mycompany.com/app",
  ]) {
    const result = run(
      { ...VALID, vars: { ...VALID.vars, FLAREMO_PUBLIC_URL: url } },
      true,
    );
    assert.ok(
      result.errorCodes.includes("PUBLIC_URL_PLACEHOLDER"),
      `expected ${JSON.stringify(url)} to be rejected`,
    );
  }
});

test("warns when the D1 binding is missing entirely", () => {
  const result = run({ ...VALID, d1_databases: [] }, true);
  assert.ok(result.warningCodes.includes("NO_D1_BINDING"));
  assert.deepEqual(result.errorCodes, []);
});

test("warns on an unusual embedding dimension", () => {
  const result = run(
    { ...VALID, vars: { ...VALID.vars, FLAREMO_EMBEDDING_DIMENSIONS: "42" } },
    true,
  );
  assert.ok(result.warningCodes.includes("EMBEDDING_DIMENSIONS_UNUSUAL"));
});

test("warns when workers-ai is set without a numeric dimension", () => {
  const result = run(
    { ...VALID, vars: { ...VALID.vars, FLAREMO_EMBEDDING_DIMENSIONS: "" } },
    true,
  );
  assert.ok(result.warningCodes.includes("EMBEDDING_DIMENSIONS_MISSING"));
});

test("warns when the config has no worker name", () => {
  const result = run({ ...VALID, name: undefined }, true);
  assert.ok(result.warningCodes.includes("NO_NAME"));
});
