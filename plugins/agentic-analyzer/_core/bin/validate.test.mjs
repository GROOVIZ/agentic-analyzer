import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cli  = join(here, "validate.mjs");

function run(schemaPath, dataPath) {
  return spawnSync("node", [cli, schemaPath, dataPath], { encoding: "utf8" });
}

function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), "validate-test-"));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

const SAMPLE_SCHEMA = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "required": ["id", "decision"],
  "properties": {
    "id":       { "type": "string" },
    "decision": { "enum": ["retain", "remove", "externalize", "needs_review"] },
    "hash":     { "type": "string", "pattern": "^[0-9a-f]{64}$" }
  }
};

test("validate: conforming doc passes", () => {
  withTmp((dir) => {
    const schema = join(dir, "s.json"); writeFileSync(schema, JSON.stringify(SAMPLE_SCHEMA));
    const data   = join(dir, "d.json"); writeFileSync(data, JSON.stringify({ id: "x", decision: "retain" }));
    const r = run(schema, data);
    assert.equal(r.status, 0, r.stderr + r.stdout);
  });
});

test("validate: missing required field fails", () => {
  withTmp((dir) => {
    const schema = join(dir, "s.json"); writeFileSync(schema, JSON.stringify(SAMPLE_SCHEMA));
    const data   = join(dir, "d.json"); writeFileSync(data, JSON.stringify({ id: "x" }));
    const r = run(schema, data);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr + r.stdout, /required/i);
  });
});

test("validate: wrong enum value fails", () => {
  withTmp((dir) => {
    const schema = join(dir, "s.json"); writeFileSync(schema, JSON.stringify(SAMPLE_SCHEMA));
    const data   = join(dir, "d.json"); writeFileSync(data, JSON.stringify({ id: "x", decision: "not-a-real-decision" }));
    const r = run(schema, data);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr + r.stdout, /enum|allowed/i);
  });
});

test("validate: missing data file fails with a clear message", () => {
  withTmp((dir) => {
    const schema = join(dir, "s.json"); writeFileSync(schema, JSON.stringify(SAMPLE_SCHEMA));
    const r = run(schema, "/nonexistent/file.json");
    assert.notEqual(r.status, 0);
    assert.match(r.stderr + r.stdout, /ENOENT|not found|no such/i);
  });
});

test("validate: missing schema file fails with a clear message", () => {
  withTmp((dir) => {
    const data = join(dir, "empty.json"); writeFileSync(data, "{}");
    const r = run("/nonexistent/schema.json", data);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr + r.stdout, /ENOENT|not found|no such/i);
  });
});

test("validate: prints JSON-pointer path for invalid fields", () => {
  withTmp((dir) => {
    const schema = join(dir, "s.json"); writeFileSync(schema, JSON.stringify(SAMPLE_SCHEMA));
    const data   = join(dir, "d.json"); writeFileSync(data, JSON.stringify({ id: "x", decision: "retain", hash: "not-hex" }));
    const r = run(schema, data);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr + r.stdout, /\/hash/);
  });
});
