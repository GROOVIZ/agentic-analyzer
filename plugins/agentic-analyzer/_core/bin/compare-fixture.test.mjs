import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cli  = join(here, "compare-fixture.mjs");

function run(dir, extraArgs = []) {
  return spawnSync("node", [cli, dir, ...extraArgs], { encoding: "utf8" });
}

function fixture(expected, actual) {
  const dir = mkdtempSync(join(tmpdir(), "fixture-"));
  mkdirSync(join(dir, "actual"), { recursive: true });
  writeFileSync(join(dir, "expected.json"), JSON.stringify(expected));
  writeFileSync(join(dir, "actual/analysis.json"), JSON.stringify(actual));
  return dir;
}

function cleanup(dir) { rmSync(dir, { recursive: true, force: true }); }

// Default args simulate a caches-like analyzer.
const CACHE_ARGS = ["--entity-key=caches", "--id-field=cache_id"];

test("compare: passes when every expected tuple is present (caches analyzer)", () => {
  const dir = fixture(
    { expected: [{ cache_id: "x", decision: "retain", rule_fired: "R8a" }] },
    { caches: [{ cache_id: "x", decision: "retain", rule_fired: "R8a" }] }
  );
  try {
    const r = run(dir, CACHE_ARGS);
    assert.equal(r.status, 0, r.stderr + r.stdout);
  } finally { cleanup(dir); }
});

test("compare: fails when an expected tuple is missing", () => {
  const dir = fixture(
    { expected: [{ cache_id: "x", decision: "retain", rule_fired: "R8a" }] },
    { caches: [] }
  );
  try {
    const r = run(dir, CACHE_ARGS);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr + r.stdout, /missing/i);
    assert.match(r.stderr + r.stdout, /"cache_id":"x"/);
  } finally { cleanup(dir); }
});

test("compare: fails when decision mismatches", () => {
  const dir = fixture(
    { expected: [{ cache_id: "x", decision: "retain", rule_fired: "R8a" }] },
    { caches: [{ cache_id: "x", decision: "externalize", rule_fired: "R5" }] }
  );
  try {
    const r = run(dir, CACHE_ARGS);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr + r.stdout, /decision|rule_fired|mismatch/i);
  } finally { cleanup(dir); }
});

test("compare: ignores extra entities in actual (superset OK)", () => {
  const dir = fixture(
    { expected: [{ cache_id: "x", decision: "retain", rule_fired: "R8a" }] },
    { caches: [
      { cache_id: "x", decision: "retain", rule_fired: "R8a" },
      { cache_id: "y", decision: "remove",  rule_fired: "R1"  }
    ] }
  );
  try {
    const r = run(dir, CACHE_ARGS);
    assert.equal(r.status, 0, r.stderr + r.stdout);
  } finally { cleanup(dir); }
});

test("compare: fails on missing expected.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "fixture-empty-"));
  try {
    const r = run(dir, CACHE_ARGS);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr + r.stdout, /ENOENT|expected\.json/);
  } finally { cleanup(dir); }
});

test("compare: fails on missing actual artifact with a configurable hint", () => {
  const dir = mkdtempSync(join(tmpdir(), "fixture-no-actual-"));
  writeFileSync(join(dir, "expected.json"), JSON.stringify({ expected: [] }));
  try {
    const r = run(dir, [...CACHE_ARGS, "--hint=run /analyze-caches then copy the artifact"]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr + r.stdout, /run \/analyze-caches/);
  } finally { cleanup(dir); }
});

test("compare: passes when a forbidden id is absent (R0-style drop)", () => {
  const dir = fixture(
    { expected: [], forbidden: ["java:Registry.java:Reg.r:ad-hoc"] },
    { caches: [] }
  );
  try {
    const r = run(dir, CACHE_ARGS);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /forbidden check/);
  } finally { cleanup(dir); }
});

test("compare: fails when a forbidden id is present in actual", () => {
  const dir = fixture(
    { expected: [], forbidden: ["java:Registry.java:Reg.r:ad-hoc"] },
    { caches: [{ cache_id: "java:Registry.java:Reg.r:ad-hoc", decision: "remove", rule_fired: "R1" }] }
  );
  try {
    const r = run(dir, CACHE_ARGS);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr + r.stdout, /forbidden cache_id present/);
    assert.match(r.stderr + r.stdout, /dropped/);
  } finally { cleanup(dir); }
});

test("compare: parameterized for a different domain (logging, entries[], call_site_id)", () => {
  const dir = mkdtempSync(join(tmpdir(), "fixture-log-"));
  mkdirSync(join(dir, "actual"), { recursive: true });
  writeFileSync(join(dir, "expected.json"), JSON.stringify({
    expected: [{ call_site_id: "LogCall:Foo.java:12", verdict: "redact", rule_applied: "L3" }]
  }));
  writeFileSync(join(dir, "actual/analysis.json"), JSON.stringify({
    entries: [{ call_site_id: "LogCall:Foo.java:12", verdict: "redact", rule_applied: "L3" }]
  }));
  try {
    const r = run(dir, [
      "--entity-key=entries",
      "--id-field=call_site_id",
      "--decision-field=verdict",
      "--rule-field=rule_applied"
    ]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
  } finally { cleanup(dir); }
});

test("compare: bad invocation (missing --entity-key) exits 2 with usage", () => {
  const dir = fixture({ expected: [] }, { caches: [] });
  try {
    const r = run(dir, []);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /usage:/);
  } finally { cleanup(dir); }
});
