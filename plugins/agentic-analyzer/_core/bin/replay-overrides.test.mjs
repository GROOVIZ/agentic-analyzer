import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cli  = join(here, "replay-overrides.mjs");

function tmp() { return mkdtempSync(join(tmpdir(), "replay-")); }
function cleanup(dir) { rmSync(dir, { recursive: true, force: true }); }

function run(args) {
  return spawnSync("node", [cli, ...args], { encoding: "utf8" });
}

function makeAnalysis(entries) {
  return { schema_version: "1.0.0", caches: entries };
}

function makeOverride({ id, hash, decision = "retain", stage = "final", flagged = false }) {
  return {
    cache_id: id,
    snippet_normalized_sha256: hash,
    flagged,
    decision,
    stage,
    reviewer: "test@example.com",
    feedback: [],
    updated_at: "2026-04-21T00:00:00Z"
  };
}

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

test("replay: matched final override replaces decision, sets decision_source=override, drops confidence to low", () => {
  const dir = tmp();
  try {
    const analysisPath  = join(dir, "analysis.json");
    const overridesPath = join(dir, "overrides.json");
    writeFileSync(analysisPath, JSON.stringify(makeAnalysis([
      { cache_id: "A", decision: "remove", decision_source: "rule", rule_fired: "R1",
        confidence: "high",
        source: { snippet_normalized_sha256: HASH_A } }
    ])));
    writeFileSync(overridesPath, JSON.stringify({
      schema_version: "2.0.0",
      overrides: [ makeOverride({ id: "A", hash: HASH_A, decision: "retain" }) ]
    }));

    const r = run([
      `--analysis=${analysisPath}`,
      `--overrides=${overridesPath}`,
      "--entity-key=caches",
      "--id-field=cache_id",
      "--write"
    ]);
    assert.equal(r.status, 0, r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(report.matched, 1);
    assert.equal(report.unmatched.length, 0);

    const after = JSON.parse(readFileSync(analysisPath, "utf8"));
    assert.equal(after.caches[0].decision, "retain");
    assert.equal(after.caches[0].decision_source, "override");
    assert.equal(after.caches[0].rule_fired, "R1", "rule_fired must be preserved");
    assert.equal(after.caches[0].confidence, "low", "rule-evidence confidence should not carry past an override");
  } finally { cleanup(dir); }
});

test("replay: reviewer-supplied confidence on override is honoured", () => {
  const dir = tmp();
  try {
    const analysisPath  = join(dir, "analysis.json");
    const overridesPath = join(dir, "overrides.json");
    writeFileSync(analysisPath, JSON.stringify(makeAnalysis([
      { cache_id: "A", decision: "remove", decision_source: "rule", rule_fired: "R1",
        confidence: "high",
        source: { snippet_normalized_sha256: HASH_A } }
    ])));
    writeFileSync(overridesPath, JSON.stringify({
      schema_version: "2.0.0",
      overrides: [ { ...makeOverride({ id: "A", hash: HASH_A, decision: "retain" }), confidence: "medium" } ]
    }));

    const r = run([
      `--analysis=${analysisPath}`,
      `--overrides=${overridesPath}`,
      "--entity-key=caches",
      "--id-field=cache_id",
      "--write"
    ]);
    assert.equal(r.status, 0, r.stderr);
    const after = JSON.parse(readFileSync(analysisPath, "utf8"));
    assert.equal(after.caches[0].confidence, "medium");
  } finally { cleanup(dir); }
});

test("replay: hash mismatch = unmatched, no mutation", () => {
  const dir = tmp();
  try {
    const analysisPath  = join(dir, "analysis.json");
    const overridesPath = join(dir, "overrides.json");
    writeFileSync(analysisPath, JSON.stringify(makeAnalysis([
      { cache_id: "A", decision: "remove", decision_source: "rule", rule_fired: "R1",
        source: { snippet_normalized_sha256: HASH_A } }
    ])));
    writeFileSync(overridesPath, JSON.stringify({
      schema_version: "2.0.0",
      overrides: [ makeOverride({ id: "A", hash: HASH_B, decision: "retain" }) ]
    }));

    const r = run([
      `--analysis=${analysisPath}`,
      `--overrides=${overridesPath}`,
      "--entity-key=caches",
      "--id-field=cache_id",
      "--write"
    ]);
    assert.equal(r.status, 0);
    const report = JSON.parse(r.stdout);
    assert.equal(report.matched, 0);
    assert.equal(report.unmatched.length, 1);
    assert.match(report.unmatched[0].reason, /no live entry/);

    const after = JSON.parse(readFileSync(analysisPath, "utf8"));
    assert.equal(after.caches[0].decision, "remove", "non-matching override must not mutate");
    assert.equal(after.caches[0].decision_source, "rule");
  } finally { cleanup(dir); }
});

test("replay: tentative override does not mutate analysis", () => {
  const dir = tmp();
  try {
    const analysisPath  = join(dir, "analysis.json");
    const overridesPath = join(dir, "overrides.json");
    writeFileSync(analysisPath, JSON.stringify(makeAnalysis([
      { cache_id: "A", decision: "remove", decision_source: "rule", rule_fired: "R1",
        source: { snippet_normalized_sha256: HASH_A } }
    ])));
    writeFileSync(overridesPath, JSON.stringify({
      schema_version: "2.0.0",
      overrides: [ makeOverride({ id: "A", hash: HASH_A, decision: "retain", stage: "tentative" }) ]
    }));

    const r = run([
      `--analysis=${analysisPath}`,
      `--overrides=${overridesPath}`,
      "--entity-key=caches",
      "--id-field=cache_id",
      "--write"
    ]);
    assert.equal(r.status, 0);
    const report = JSON.parse(r.stdout);
    assert.equal(report.matched, 0);

    const after = JSON.parse(readFileSync(analysisPath, "utf8"));
    assert.equal(after.caches[0].decision, "remove");
  } finally { cleanup(dir); }
});

test("replay: flag-only override (decision null) does not mutate", () => {
  const dir = tmp();
  try {
    const analysisPath  = join(dir, "analysis.json");
    const overridesPath = join(dir, "overrides.json");
    writeFileSync(analysisPath, JSON.stringify(makeAnalysis([
      { cache_id: "A", decision: "remove", decision_source: "rule", rule_fired: "R1",
        source: { snippet_normalized_sha256: HASH_A } }
    ])));
    writeFileSync(overridesPath, JSON.stringify({
      schema_version: "2.0.0",
      overrides: [ makeOverride({ id: "A", hash: HASH_A, decision: null, stage: null, flagged: true }) ]
    }));

    const r = run([
      `--analysis=${analysisPath}`,
      `--overrides=${overridesPath}`,
      "--entity-key=caches",
      "--id-field=cache_id",
      "--write"
    ]);
    assert.equal(r.status, 0);
    const report = JSON.parse(r.stdout);
    assert.equal(report.matched, 0);

    const after = JSON.parse(readFileSync(analysisPath, "utf8"));
    assert.equal(after.caches[0].decision, "remove");
  } finally { cleanup(dir); }
});

test("replay: v1 overrides file exits 0 without applying", () => {
  const dir = tmp();
  try {
    const analysisPath  = join(dir, "analysis.json");
    const overridesPath = join(dir, "overrides.json");
    writeFileSync(analysisPath, JSON.stringify(makeAnalysis([
      { cache_id: "A", decision: "remove", decision_source: "rule", rule_fired: "R1",
        source: { snippet_normalized_sha256: HASH_A } }
    ])));
    writeFileSync(overridesPath, JSON.stringify({
      overrides: [{ cache_id: "A", snippet_normalized_sha256: HASH_A, decision: "retain", reviewer: "x", created_at: "2026-04-01T00:00:00Z" }]
    }));

    const r = run([
      `--analysis=${analysisPath}`,
      `--overrides=${overridesPath}`,
      "--entity-key=caches",
      "--id-field=cache_id",
      "--write"
    ]);
    assert.equal(r.status, 0);
    const report = JSON.parse(r.stdout);
    assert.equal(report.matched, 0);
    assert.equal(report.schema_version_seen, "legacy-v1");

    const after = JSON.parse(readFileSync(analysisPath, "utf8"));
    assert.equal(after.caches[0].decision, "remove", "v1 file must not mutate analysis");
  } finally { cleanup(dir); }
});

test("replay: dry-run (no --write) does not modify analysis on disk", () => {
  const dir = tmp();
  try {
    const analysisPath  = join(dir, "analysis.json");
    const overridesPath = join(dir, "overrides.json");
    const before = makeAnalysis([
      { cache_id: "A", decision: "remove", decision_source: "rule", rule_fired: "R1",
        source: { snippet_normalized_sha256: HASH_A } }
    ]);
    writeFileSync(analysisPath, JSON.stringify(before));
    writeFileSync(overridesPath, JSON.stringify({
      schema_version: "2.0.0",
      overrides: [ makeOverride({ id: "A", hash: HASH_A, decision: "retain" }) ]
    }));

    const r = run([
      `--analysis=${analysisPath}`,
      `--overrides=${overridesPath}`,
      "--entity-key=caches",
      "--id-field=cache_id"
    ]);
    assert.equal(r.status, 0);
    const report = JSON.parse(r.stdout);
    assert.equal(report.matched, 1);

    const after = JSON.parse(readFileSync(analysisPath, "utf8"));
    assert.deepEqual(after, before, "dry-run must not persist changes");
  } finally { cleanup(dir); }
});

test("replay: missing analysis file exits 1", () => {
  const dir = tmp();
  try {
    const overridesPath = join(dir, "overrides.json");
    writeFileSync(overridesPath, JSON.stringify({ schema_version: "2.0.0", overrides: [] }));
    const r = run([
      `--analysis=${join(dir, "nonexistent.json")}`,
      `--overrides=${overridesPath}`,
      "--entity-key=caches",
      "--id-field=cache_id"
    ]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /analysis not found/);
  } finally { cleanup(dir); }
});

test("replay: parameterised for a logging analyzer", () => {
  const dir = tmp();
  try {
    const analysisPath  = join(dir, "analysis.json");
    const overridesPath = join(dir, "overrides.json");
    writeFileSync(analysisPath, JSON.stringify({
      schema_version: "1.0.0",
      entries: [
        { call_site_id: "Foo.java:12", decision: "allow", decision_source: "rule", rule_fired: "L1",
          source: { snippet_normalized_sha256: HASH_A } }
      ]
    }));
    writeFileSync(overridesPath, JSON.stringify({
      schema_version: "2.0.0",
      overrides: [{
        call_site_id: "Foo.java:12",
        snippet_normalized_sha256: HASH_A,
        flagged: false,
        decision: "redact",
        stage: "final",
        reviewer: "reviewer@x",
        feedback: [],
        updated_at: "2026-04-21T00:00:00Z"
      }]
    }));

    const r = run([
      `--analysis=${analysisPath}`,
      `--overrides=${overridesPath}`,
      "--entity-key=entries",
      "--id-field=call_site_id",
      "--write"
    ]);
    assert.equal(r.status, 0, r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(report.matched, 1);

    const after = JSON.parse(readFileSync(analysisPath, "utf8"));
    assert.equal(after.entries[0].decision, "redact");
    assert.equal(after.entries[0].decision_source, "override");
  } finally { cleanup(dir); }
});

test("replay: bad invocation exits 2 with usage", () => {
  const r = run([]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage:/);
});
