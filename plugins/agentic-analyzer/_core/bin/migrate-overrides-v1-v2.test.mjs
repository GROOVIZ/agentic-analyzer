import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cli  = join(here, "migrate-overrides-v1-v2.mjs");

function tmp() { return mkdtempSync(join(tmpdir(), "migrate-")); }
function cleanup(dir) { rmSync(dir, { recursive: true, force: true }); }
function run(args) { return spawnSync("node", [cli, ...args], { encoding: "utf8" }); }

const HASH = "a".repeat(64);

test("migrate: v1 → v2 shape, in-place, creates backup", () => {
  const dir = tmp();
  try {
    const p = join(dir, "overrides.json");
    writeFileSync(p, JSON.stringify({
      overrides: [{
        cache_id: "X",
        snippet_normalized_sha256: HASH,
        decision: "retain",
        reviewer: "a@b",
        note: "old free-text",
        created_at: "2026-03-01T00:00:00Z"
      }]
    }));

    const r = run([`--input=${p}`, "--id-field=cache_id"]);
    assert.equal(r.status, 0, r.stderr);

    const out = JSON.parse(readFileSync(p, "utf8"));
    assert.equal(out.schema_version, "2.0.0");
    assert.equal(out.overrides.length, 1);
    const e = out.overrides[0];
    assert.equal(e.cache_id, "X");
    assert.equal(e.flagged, false);
    assert.equal(e.stage, "final");
    assert.deepEqual(e.feedback, []);
    assert.equal(e.updated_at, "2026-03-01T00:00:00Z");
    assert.equal(e.note, undefined, "v1 note must be dropped");

    assert.ok(existsSync(`${p}.v1.bak.json`), "backup must exist");
  } finally { cleanup(dir); }
});

test("migrate: already-v2 file is a no-op", () => {
  const dir = tmp();
  try {
    const p = join(dir, "overrides.json");
    const v2 = {
      schema_version: "2.0.0",
      overrides: [{
        cache_id: "X", snippet_normalized_sha256: HASH,
        flagged: false, decision: "retain", stage: "final",
        reviewer: "a@b", feedback: [], updated_at: "2026-03-01T00:00:00Z"
      }]
    };
    writeFileSync(p, JSON.stringify(v2));

    const r = run([`--input=${p}`, "--id-field=cache_id"]);
    assert.equal(r.status, 0);

    const out = JSON.parse(readFileSync(p, "utf8"));
    assert.deepEqual(out, v2);
  } finally { cleanup(dir); }
});

test("migrate: --output writes to a different file, input is untouched", () => {
  const dir = tmp();
  try {
    const src = join(dir, "v1.json");
    const dst = join(dir, "v2.json");
    writeFileSync(src, JSON.stringify({
      overrides: [{
        cache_id: "X", snippet_normalized_sha256: HASH,
        decision: "retain", reviewer: "a@b",
        created_at: "2026-03-01T00:00:00Z"
      }]
    }));
    const srcBefore = readFileSync(src, "utf8");

    const r = run([`--input=${src}`, `--output=${dst}`, "--id-field=cache_id"]);
    assert.equal(r.status, 0, r.stderr);

    const srcAfter = readFileSync(src, "utf8");
    assert.equal(srcBefore, srcAfter, "input must be untouched when --output is set");
    const out = JSON.parse(readFileSync(dst, "utf8"));
    assert.equal(out.schema_version, "2.0.0");
  } finally { cleanup(dir); }
});

test("migrate: parameterised id field", () => {
  const dir = tmp();
  try {
    const p = join(dir, "overrides.json");
    writeFileSync(p, JSON.stringify({
      overrides: [{
        call_site_id: "Foo.java:12",
        snippet_normalized_sha256: HASH,
        decision: "redact",
        reviewer: "r@x",
        created_at: "2026-03-01T00:00:00Z"
      }]
    }));

    const r = run([`--input=${p}`, "--id-field=call_site_id"]);
    assert.equal(r.status, 0, r.stderr);

    const out = JSON.parse(readFileSync(p, "utf8"));
    assert.equal(out.overrides[0].call_site_id, "Foo.java:12");
  } finally { cleanup(dir); }
});

test("migrate: missing input exits 1", () => {
  const r = run(["--input=/nonexistent", "--id-field=cache_id"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not found/);
});

test("migrate: bad invocation exits 2", () => {
  const r = run([]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage:/);
});
