import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cli  = join(here, "compare-entities.mjs");

function tmp() { return mkdtempSync(join(tmpdir(), "compare-entities-")); }
function cleanup(dir) { rmSync(dir, { recursive: true, force: true }); }
function run(args) { return spawnSync("node", [cli, ...args], { encoding: "utf8" }); }

// Helper: write a canonical expected-entities file and an analysis file,
// then run the comparator.
function scenario({ expected, analysis, extraArgs = [] }) {
  const dir = tmp();
  const expectedPath = join(dir, "expected-entities.json");
  const analysisPath = join(dir, "analysis.json");
  writeFileSync(expectedPath, JSON.stringify({
    schema_version: "1.0.0",
    entities: expected
  }));
  writeFileSync(analysisPath, JSON.stringify({
    entries: analysis
  }));
  const r = run([expectedPath, analysisPath, "--entity-key=entries", "--id-field=call_site_id", ...extraArgs]);
  return { dir, r };
}

// --- Matching & happy path ---

test("compare-entities: exits 0 when every expected entity matches exactly one entry", () => {
  const { dir, r } = scenario({
    expected: [{ name: "userSignupLogger" }, { name: "orderAudit" }],
    analysis: [
      { call_site_id: "java:src/Foo.java:Foo.bar:userSignupLogger", decision: "allow", rule_fired: "L1" },
      { call_site_id: "java:src/Bar.java:Bar.baz:orderAudit",       decision: "allow", rule_fired: "L1" }
    ]
  });
  try {
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /2\s+matched/);
  } finally { cleanup(dir); }
});

test("compare-entities: exits 0 when entities list is empty", () => {
  const { dir, r } = scenario({ expected: [], analysis: [] });
  try {
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /0\s+(expected|entities)/i);
  } finally { cleanup(dir); }
});

// --- MISSED ---

test("compare-entities: reports MISSED when an expected name is absent from the analyzer output", () => {
  const { dir, r } = scenario({
    expected: [{ name: "azertyentity" }],
    analysis: [{ call_site_id: "java:src/Foo.java:Foo.bar:somethingElse", decision: "allow", rule_fired: "L1" }]
  });
  try {
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /MISSED/);
    assert.match(r.stdout + r.stderr, /azertyentity/);
  } finally { cleanup(dir); }
});

test("compare-entities: MISSED count appears in the summary line", () => {
  const { dir, r } = scenario({
    expected: [{ name: "a" }, { name: "b" }, { name: "c" }],
    analysis: [{ call_site_id: "x:y:z:a", decision: "allow", rule_fired: "L1" }]
  });
  try {
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /2 missed/i);
  } finally { cleanup(dir); }
});

// --- AMBIGUOUS ---

test("compare-entities: reports AMBIGUOUS when a name matches multiple analyzer entries", () => {
  const { dir, r } = scenario({
    expected: [{ name: "sessionCache" }],
    analysis: [
      { call_site_id: "java:src/UserSvc.java:UserSvc.login:sessionCache",  decision: "retain",      rule_fired: "R2" },
      { call_site_id: "java:src/OrderSvc.java:OrderSvc.place:sessionCache", decision: "externalize", rule_fired: "R5" }
    ]
  });
  try {
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /AMBIGUOUS/);
    assert.match(r.stdout + r.stderr, /sessionCache/);
    // Both candidate IDs should appear so the dev team can disambiguate.
    assert.match(r.stdout + r.stderr, /UserSvc/);
    assert.match(r.stdout + r.stderr, /OrderSvc/);
  } finally { cleanup(dir); }
});

// --- DECISION-MISMATCH ---

test("compare-entities: reports DECISION-MISMATCH when expected_decision differs from actual", () => {
  const { dir, r } = scenario({
    expected: [{ name: "piiLogger", expected_decision: "redact" }],
    analysis: [{ call_site_id: "java:src/U.java:U.m:piiLogger", decision: "allow", rule_fired: "L1" }]
  });
  try {
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /DECISION-MISMATCH/);
    assert.match(r.stdout + r.stderr, /piiLogger/);
    assert.match(r.stdout + r.stderr, /expected\s+redact/i);
    assert.match(r.stdout + r.stderr, /got\s+allow/i);
  } finally { cleanup(dir); }
});

test("compare-entities: no DECISION-MISMATCH when expected_decision matches actual", () => {
  const { dir, r } = scenario({
    expected: [{ name: "piiLogger", expected_decision: "redact" }],
    analysis: [{ call_site_id: "java:src/U.java:U.m:piiLogger", decision: "redact", rule_fired: "L2" }]
  });
  try {
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally { cleanup(dir); }
});

test("compare-entities: no DECISION-MISMATCH when expected_decision is absent", () => {
  const { dir, r } = scenario({
    expected: [{ name: "piiLogger" }], // no expected_decision
    analysis: [{ call_site_id: "java:src/U.java:U.m:piiLogger", decision: "allow", rule_fired: "L1" }]
  });
  try {
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally { cleanup(dir); }
});

// --- Matching semantics ---

test("compare-entities: endsWith(:name) matching tolerates rust double-colon and ts namespace ids", () => {
  const { dir, r } = scenario({
    expected: [{ name: "featureFlagX" }, { name: "SessionCache" }],
    analysis: [
      { call_site_id: "rust:src/lib.rs:module::fn:featureFlagX", decision: "keep", rule_fired: "F1" },
      { call_site_id: "ts:src/app.ts:UserService:SessionCache",  decision: "retain", rule_fired: "R1" }
    ]
  });
  try {
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally { cleanup(dir); }
});

test("compare-entities: suffix match does not falsely match a longer-suffix name", () => {
  // Expected name "foo" must NOT match id ending with ":barfoo" — the colon boundary matters.
  const { dir, r } = scenario({
    expected: [{ name: "foo" }],
    analysis: [{ call_site_id: "x:y:z:barfoo", decision: "allow", rule_fired: "L1" }]
  });
  try {
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /MISSED/);
  } finally { cleanup(dir); }
});

test("compare-entities: case-insensitive flag relaxes the name match", () => {
  const { dir, r } = scenario({
    expected: [{ name: "useridcache" }],
    analysis: [{ call_site_id: "java:src/U.java:U.m:UserIdCache", decision: "retain", rule_fired: "R1" }],
    extraArgs: ["--case-insensitive"]
  });
  try {
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally { cleanup(dir); }
});

test("compare-entities: without --case-insensitive, case differences do not match", () => {
  const { dir, r } = scenario({
    expected: [{ name: "useridcache" }],
    analysis: [{ call_site_id: "java:src/U.java:U.m:UserIdCache", decision: "retain", rule_fired: "R1" }]
  });
  try {
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /MISSED/);
  } finally { cleanup(dir); }
});

// --- Multi-category in one run ---

test("compare-entities: reports MISSED, AMBIGUOUS, and DECISION-MISMATCH in one pass", () => {
  const { dir, r } = scenario({
    expected: [
      { name: "missingOne" },
      { name: "ambig" },
      { name: "wrongDecision", expected_decision: "redact" }
    ],
    analysis: [
      { call_site_id: "x:y:z:ambig",         decision: "retain", rule_fired: "R1" },
      { call_site_id: "x:a:b:ambig",         decision: "retain", rule_fired: "R1" },
      { call_site_id: "x:y:z:wrongDecision", decision: "allow",  rule_fired: "L1" }
    ]
  });
  try {
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /MISSED/);
    assert.match(r.stdout + r.stderr, /AMBIGUOUS/);
    assert.match(r.stdout + r.stderr, /DECISION-MISMATCH/);
  } finally { cleanup(dir); }
});

// --- Usage / error handling ---

test("compare-entities: exits 2 with usage on missing args", () => {
  const r = run([]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage/i);
});

test("compare-entities: exits 2 when --entity-key is missing", () => {
  const dir = tmp();
  try {
    const expected = join(dir, "e.json");
    const analysis = join(dir, "a.json");
    writeFileSync(expected, JSON.stringify({ schema_version: "1.0.0", entities: [] }));
    writeFileSync(analysis, JSON.stringify({ entries: [] }));
    const r = run([expected, analysis, "--id-field=call_site_id"]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /entity-key/);
  } finally { cleanup(dir); }
});

test("compare-entities: exits 2 when the expected-entities file is missing", () => {
  const dir = tmp();
  try {
    const analysis = join(dir, "a.json");
    writeFileSync(analysis, JSON.stringify({ entries: [] }));
    const r = run([join(dir, "does-not-exist.json"), analysis, "--entity-key=entries", "--id-field=call_site_id"]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /expected.*not found|ENOENT/i);
  } finally { cleanup(dir); }
});

// --- SUSPICIOUS (post-parse linter) ---

test("compare-entities: reports SUSPICIOUS for a name containing whitespace", () => {
  const { dir, r } = scenario({
    expected: [{ name: "some logger" }],
    analysis: []
  });
  try {
    assert.match(r.stdout + r.stderr, /SUSPICIOUS/);
    assert.match(r.stdout + r.stderr, /some logger/);
  } finally { cleanup(dir); }
});

test("compare-entities: reports SUSPICIOUS for punctuation outside [_\\-.:]", () => {
  const { dir, r } = scenario({
    expected: [{ name: "broken!" }, { name: "weird$name" }],
    analysis: []
  });
  try {
    assert.match(r.stdout + r.stderr, /SUSPICIOUS/);
    assert.match(r.stdout + r.stderr, /broken!/);
    assert.match(r.stdout + r.stderr, /weird\$name/);
  } finally { cleanup(dir); }
});

test("compare-entities: reports SUSPICIOUS for a name longer than 64 chars", () => {
  const longName = "a".repeat(65);
  const { dir, r } = scenario({
    expected: [{ name: longName }],
    analysis: []
  });
  try {
    assert.match(r.stdout + r.stderr, /SUSPICIOUS/);
    assert.match(r.stdout + r.stderr, /too long/i);
  } finally { cleanup(dir); }
});

test("compare-entities: does not report SUSPICIOUS for clean names with allowed separators", () => {
  const { dir, r } = scenario({
    expected: [
      { name: "userSignupLogger" },
      { name: "session_cache" },
      { name: "logging-v2" },
      { name: "flag.key.name" },
      { name: "ns:flag" }
    ],
    analysis: [
      { call_site_id: "x:y:z:userSignupLogger", decision: "allow", rule_fired: "L1" },
      { call_site_id: "x:y:z:session_cache",    decision: "allow", rule_fired: "L1" },
      { call_site_id: "x:y:z:logging-v2",       decision: "allow", rule_fired: "L1" },
      { call_site_id: "x:y:z:flag.key.name",    decision: "allow", rule_fired: "L1" },
      { call_site_id: "x:y:z:ns:flag",          decision: "allow", rule_fired: "L1" }
    ]
  });
  try {
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout + r.stderr, /SUSPICIOUS/);
  } finally { cleanup(dir); }
});

test("compare-entities: SUSPICIOUS alone does NOT change exit code when no gaps", () => {
  // Linter hit + matching analyzer entry → warn but still exit 0.
  // The oddly-named entity also happens to match an equally-odd analyzer id.
  const { dir, r } = scenario({
    expected: [{ name: "has space" }],
    analysis: [{ call_site_id: "x:y:z:has space", decision: "allow", rule_fired: "L1" }]
  });
  try {
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /SUSPICIOUS/);
    assert.match(r.stdout + r.stderr, /has space/);
  } finally { cleanup(dir); }
});

// --- original (kept below the linter block) ---

test("compare-entities: exits 2 when the expected-entities file is not schema-valid", () => {
  const dir = tmp();
  try {
    const expected = join(dir, "e.json");
    const analysis = join(dir, "a.json");
    // Missing `schema_version`.
    writeFileSync(expected, JSON.stringify({ entities: [{ name: "x" }] }));
    writeFileSync(analysis, JSON.stringify({ entries: [] }));
    const r = run([expected, analysis, "--entity-key=entries", "--id-field=call_site_id"]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /schema|validation/i);
  } finally { cleanup(dir); }
});
