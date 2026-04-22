import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cli  = join(here, "validate-scaffold.mjs");

function tmp() { return mkdtempSync(join(tmpdir(), "validate-scaffold-")); }
function cleanup(dir) { rmSync(dir, { recursive: true, force: true }); }
function run(args) { return spawnSync("node", [cli, ...args], { encoding: "utf8" }); }

// The full set of files a post-/new-analyzer skill directory must contain.
// Stamp produces everything except rules.md (which /new-analyzer writes
// directly) and bin/*.mjs (which /new-analyzer copies from _core/bin).
const VALID_FILES = {
  "SKILL.md":
`---
name: analyze-logging
description: Answers the question "Should this log call be allowed under PII rules?" by discovering every Log call-site in a target repository.
allowed-tools:
  - Read
---

body goes here
`,
  "rules.md":       "# rules\n\n| id | label |\n|----|-------|\n| L1 | yes |\n",
  "package.json":   `{ "name": "analyze-logging" }`,
  "prompts/discovery.md":      "# discovery\n",
  "prompts/classification.md": "# classification\n",
  "schema/analysis.schema.json":   `{ "title": "ok" }`,
  "schema/candidates.schema.json": `{ "title": "ok" }`,
  "schema/coverage.schema.json":   `{ "title": "ok" }`,
  "schema/overrides.schema.json":  `{ "title": "ok" }`,
  "bin/_args.mjs":                   "export {};\n",
  "bin/validate.mjs":                "export {};\n",
  "bin/normalize.mjs":               "export {};\n",
  "bin/compare-fixture.mjs":         "export {};\n",
  "bin/replay-overrides.mjs":        "export {};\n",
  "bin/migrate-overrides-v1-v2.mjs": "export {};\n",
  "bin/fixture-init.mjs":            "export {};\n"
};

function buildScaffold({ overrides = {}, omit = [] } = {}) {
  const dir = tmp();
  const skillDir = join(dir, "analyze-logging");
  mkdirSync(skillDir, { recursive: true });
  const all = { ...VALID_FILES, ...overrides };
  for (const [rel, contents] of Object.entries(all)) {
    if (omit.includes(rel)) continue;
    const abs = join(skillDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contents);
  }
  return { dir, skillDir };
}

test("validate-scaffold: passes for a complete valid scaffold", () => {
  const { dir, skillDir } = buildScaffold();
  try {
    const r = run([skillDir]);
    assert.equal(r.status, 0, r.stderr);
  } finally { cleanup(dir); }
});

test("validate-scaffold: fails when SKILL.md is missing", () => {
  const { dir, skillDir } = buildScaffold({ omit: ["SKILL.md"] });
  try {
    const r = run([skillDir]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /missing: SKILL\.md/);
  } finally { cleanup(dir); }
});

test("validate-scaffold: fails when rules.md is missing", () => {
  const { dir, skillDir } = buildScaffold({ omit: ["rules.md"] });
  try {
    const r = run([skillDir]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /missing: rules\.md/);
  } finally { cleanup(dir); }
});

test("validate-scaffold: fails when a bin/ runtime file is missing", () => {
  const { dir, skillDir } = buildScaffold({ omit: ["bin/validate.mjs"] });
  try {
    const r = run([skillDir]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /missing: bin\/validate\.mjs/);
  } finally { cleanup(dir); }
});

test("validate-scaffold: fails when a schema file is missing", () => {
  const { dir, skillDir } = buildScaffold({ omit: ["schema/analysis.schema.json"] });
  try {
    const r = run([skillDir]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /missing: schema\/analysis\.schema\.json/);
  } finally { cleanup(dir); }
});

test("validate-scaffold: fails when a prompt is missing", () => {
  const { dir, skillDir } = buildScaffold({ omit: ["prompts/discovery.md"] });
  try {
    const r = run([skillDir]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /missing: prompts\/discovery\.md/);
  } finally { cleanup(dir); }
});

test("validate-scaffold: fails when an unresolved {{PLACEHOLDER}} remains in a stamped file", () => {
  const { dir, skillDir } = buildScaffold({
    overrides: { "prompts/discovery.md": "# discovery\n\nThe target is {{TARGET_CONST}}.\n" }
  });
  try {
    const r = run([skillDir]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /unresolved placeholder/);
    assert.match(r.stderr, /prompts\/discovery\.md/);
    assert.match(r.stderr, /TARGET_CONST/);
  } finally { cleanup(dir); }
});

test("validate-scaffold: fails when SKILL.md has no YAML frontmatter", () => {
  const { dir, skillDir } = buildScaffold({
    overrides: { "SKILL.md": "# just a heading, no frontmatter\n" }
  });
  try {
    const r = run([skillDir]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /frontmatter/i);
  } finally { cleanup(dir); }
});

test("validate-scaffold: fails when SKILL.md frontmatter is not closed", () => {
  const { dir, skillDir } = buildScaffold({
    overrides: { "SKILL.md": "---\nname: analyze-logging\ndescription: x\n\nbody\n" }
  });
  try {
    const r = run([skillDir]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /frontmatter/i);
  } finally { cleanup(dir); }
});

test("validate-scaffold: fails when SKILL.md name is not analyze-<slug>", () => {
  const { dir, skillDir } = buildScaffold({
    overrides: {
      "SKILL.md":
`---
name: Something With Spaces
description: valid desc
---
body
`
    }
  });
  try {
    const r = run([skillDir]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /name/);
    assert.match(r.stderr, /analyze-/);
  } finally { cleanup(dir); }
});

test("validate-scaffold: fails when SKILL.md description is empty", () => {
  const { dir, skillDir } = buildScaffold({
    overrides: {
      "SKILL.md":
`---
name: analyze-logging
description:
---
body
`
    }
  });
  try {
    const r = run([skillDir]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /description/);
  } finally { cleanup(dir); }
});

test("validate-scaffold: fails when SKILL.md description is absent", () => {
  const { dir, skillDir } = buildScaffold({
    overrides: {
      "SKILL.md":
`---
name: analyze-logging
---
body
`
    }
  });
  try {
    const r = run([skillDir]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /description/);
  } finally { cleanup(dir); }
});

test("validate-scaffold: fails when target skill dir does not exist", () => {
  const dir = tmp();
  try {
    const r = run([join(dir, "does-not-exist")]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /not found|does not exist|ENOENT/i);
  } finally { cleanup(dir); }
});

test("validate-scaffold: requires the skill-dir argument", () => {
  const r = run([]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /usage/i);
});

test("validate-scaffold: reports multiple issues in a single run", () => {
  const { dir, skillDir } = buildScaffold({
    overrides: { "prompts/discovery.md": "uses {{THING}}" },
    omit: ["SKILL.md", "rules.md"]
  });
  try {
    const r = run([skillDir]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /missing: SKILL\.md/);
    assert.match(r.stderr, /missing: rules\.md/);
    assert.match(r.stderr, /unresolved placeholder/);
  } finally { cleanup(dir); }
});

// --- --rule-ids fixture-coverage check ---

function writeFixture(skillDir, id) {
  const dir = join(skillDir, "fixtures", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "expected.json"), `{ "expected": [] }\n`);
}

test("validate-scaffold: --rule-ids passes when every rule has a fixture", () => {
  const { dir, skillDir } = buildScaffold({
    overrides: { "rules.md": "# rules\n\n| ID | Rule | Decision |\n|----|------|----------|\n| L1 | a | allow |\n| L2 | b | redact |\n" }
  });
  writeFixture(skillDir, "L1");
  writeFixture(skillDir, "L2");
  try {
    const r = run([skillDir, "--rule-ids=L1,L2"]);
    assert.equal(r.status, 0, r.stderr);
  } finally { cleanup(dir); }
});

test("validate-scaffold: --rule-ids fails when a rule has no fixture dir", () => {
  const { dir, skillDir } = buildScaffold();
  writeFixture(skillDir, "L1");
  // L2 intentionally missing
  try {
    const r = run([skillDir, "--rule-ids=L1,L2"]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /missing fixture/);
    assert.match(r.stderr, /L2/);
  } finally { cleanup(dir); }
});

test("validate-scaffold: --rule-ids fails when expected.json is absent", () => {
  const { dir, skillDir } = buildScaffold();
  mkdirSync(join(skillDir, "fixtures", "L1"), { recursive: true });
  // no expected.json inside
  try {
    const r = run([skillDir, "--rule-ids=L1"]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /missing fixture/);
    assert.match(r.stderr, /L1/);
    assert.match(r.stderr, /expected\.json/);
  } finally { cleanup(dir); }
});

test("validate-scaffold: --rule-ids rejects an empty value", () => {
  const { dir, skillDir } = buildScaffold();
  try {
    const r = run([skillDir, "--rule-ids="]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /--rule-ids/);
  } finally { cleanup(dir); }
});

test("validate-scaffold: --rule-ids ignores whitespace around ids", () => {
  const { dir, skillDir } = buildScaffold({
    overrides: { "rules.md": "# rules\n\n| ID | Rule | Decision |\n|----|------|----------|\n| L1 | a | allow |\n| L2 | b | redact |\n" }
  });
  writeFixture(skillDir, "L1");
  writeFixture(skillDir, "L2");
  try {
    const r = run([skillDir, "--rule-ids= L1 , L2 "]);
    assert.equal(r.status, 0, r.stderr);
  } finally { cleanup(dir); }
});

test("validate-scaffold: without --rule-ids does not require a fixtures/ dir", () => {
  // A minimally scaffolded skill (no fixtures yet) must still pass the
  // baseline validator — fixture coverage is an opt-in check.
  const { dir, skillDir } = buildScaffold();
  try {
    const r = run([skillDir]);
    assert.equal(r.status, 0, r.stderr);
  } finally { cleanup(dir); }
});

// --- rules.md cross-check ---

const REALISTIC_RULES_MD =
`# Logging rules

**Version:** ruleset_version: "2026-04-22"
**Target (fixed):** pii-regulated.

Apply rules in evaluation order; first rule that fires decides.

| ID | Rule | Decision |
|----|------|----------|
| L1 | no PII token in message | allow |
| L2 | PII token present       | redact |
| L3 | catch-all               | needs_review |
`;

test("validate-scaffold: --rule-ids fails when a CLI id is absent from the rules.md table", () => {
  const { dir, skillDir } = buildScaffold({
    overrides: { "rules.md": REALISTIC_RULES_MD }
  });
  writeFixture(skillDir, "L1");
  writeFixture(skillDir, "L2");
  writeFixture(skillDir, "L3");
  writeFixture(skillDir, "LX"); // fixture exists but rule doesn't
  try {
    const r = run([skillDir, "--rule-ids=L1,L2,L3,LX"]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /LX/);
    assert.match(r.stderr, /rules\.md/i);
  } finally { cleanup(dir); }
});

test("validate-scaffold: --rule-ids fails when a rules.md table id is absent from the CLI", () => {
  const { dir, skillDir } = buildScaffold({
    overrides: { "rules.md": REALISTIC_RULES_MD }
  });
  writeFixture(skillDir, "L1");
  writeFixture(skillDir, "L2");
  // L3 fixture and CLI id both missing
  try {
    const r = run([skillDir, "--rule-ids=L1,L2"]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /L3/);
    assert.match(r.stderr, /rules\.md/i);
  } finally { cleanup(dir); }
});

test("validate-scaffold: --rule-ids passes when the CLI ids exactly match the rules.md table", () => {
  const { dir, skillDir } = buildScaffold({
    overrides: { "rules.md": REALISTIC_RULES_MD }
  });
  writeFixture(skillDir, "L1");
  writeFixture(skillDir, "L2");
  writeFixture(skillDir, "L3");
  try {
    const r = run([skillDir, "--rule-ids=L1,L2,L3"]);
    assert.equal(r.status, 0, r.stderr);
  } finally { cleanup(dir); }
});

test("validate-scaffold: cross-check is skipped when rules.md has no parseable ID-column table", () => {
  // An author may have a rules.md without the standard table (e.g., during
  // heavy iteration). The cross-check should NOT fire in that case — only
  // the fixture-coverage check applies.
  const { dir, skillDir } = buildScaffold({
    overrides: { "rules.md": "# rules\n\nWork in progress — no table yet.\n" }
  });
  writeFixture(skillDir, "L1");
  try {
    const r = run([skillDir, "--rule-ids=L1"]);
    assert.equal(r.status, 0, r.stderr);
  } finally { cleanup(dir); }
});

test("validate-scaffold: cross-check tolerates extra whitespace around ids in the table", () => {
  const whitespaceTable =
`# rules

|  ID  |  Rule  |  Decision  |
|------|--------|------------|
|  L1  |  first |  allow     |
|  L2  | second |  redact    |
`;
  const { dir, skillDir } = buildScaffold({ overrides: { "rules.md": whitespaceTable } });
  writeFixture(skillDir, "L1");
  writeFixture(skillDir, "L2");
  try {
    const r = run([skillDir, "--rule-ids=L1,L2"]);
    assert.equal(r.status, 0, r.stderr);
  } finally { cleanup(dir); }
});
