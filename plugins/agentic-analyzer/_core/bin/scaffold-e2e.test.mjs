import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cli  = join(here, "stamp.mjs");
const templatesDir = join(here, "..", "templates");

function tmp() { return mkdtempSync(join(tmpdir(), "scaffold-e2e-")); }
function cleanup(dir) { rmSync(dir, { recursive: true, force: true }); }

const CACHES_CONFIG = {
  analyzer_name: "caches",
  entity_name_human: "Cache",
  entity_key: "caches",
  id_field: "cache_id",
  target_const: "multi-replica-openshift",
  decision_enum: ["retain", "externalize", "remove"],
  rule_ids: ["R1","R2","R3","R4","R5","R6","R7","R8a","R8b","R9a","R9b","R10","R11"],
  language: "java",
  frameworks: ["caffeine", "ehcache", "redis"],
  source_roots: ["src/main/java"],
  manifest_list: ["pom.xml", "build.gradle", "build.gradle.kts"],
  target_question: "Is this cache safe on multi-replica OpenShift?"
};

const LOGGING_CONFIG = {
  analyzer_name: "logging",
  entity_name_human: "Log call-site",
  entity_key: "entries",
  id_field: "call_site_id",
  target_const: "pii-regulated",
  decision_enum: ["allow", "redact", "remove"],
  rule_ids: ["L1","L2","L3","L4"],
  language: "java",
  frameworks: ["slf4j", "logback"],
  source_roots: ["src/main/java"],
  manifest_list: ["pom.xml", "build.gradle", "build.gradle.kts"],
  target_question: "Should this log call be allowed under PII rules?"
};

function scaffold(config) {
  const dir = tmp();
  const cfg = join(dir, "config.json");
  const out = join(dir, "out");
  writeFileSync(cfg, JSON.stringify(config));
  const r = spawnSync("node", [cli, `--config=${cfg}`, `--templates=${templatesDir}`, `--out=${out}`], { encoding: "utf8" });
  return { dir, out, r };
}

test("e2e: full scaffold for caches config produces every expected artifact", () => {
  const { dir, out, r } = scaffold(CACHES_CONFIG);
  try {
    assert.equal(r.status, 0, r.stderr);
    for (const f of [
      "SKILL.md",
      "rules.md",
      "prompts/discovery.md",
      "prompts/classification.md",
      "analysis.schema.json",
      "candidates.schema.json",
      "coverage.schema.json",
      "overrides.schema.json",
      "package.json"
    ]) {
      assert.ok(existsSync(join(out, f)), `missing: ${f}`);
    }
  } finally { cleanup(dir); }
});

test("e2e: SKILL.md has placeholders fully resolved", () => {
  const { dir, out, r } = scaffold(CACHES_CONFIG);
  try {
    assert.equal(r.status, 0);
    const skill = readFileSync(join(out, "SKILL.md"), "utf8");
    // frontmatter name
    assert.match(skill, /name:\s*analyze-caches/);
    // target const appears in Step 5
    assert.match(skill, /target: "multi-replica-openshift"/);
    // entity key appears in output path
    assert.match(skill, /caches-analysis\/output/);
    // no unresolved placeholders remain
    assert.doesNotMatch(skill, /\{\{[A-Z_]+\}\}/, "unresolved placeholders in SKILL.md");
  } finally { cleanup(dir); }
});

test("e2e: rules.md mentions the analyzer's decision set", () => {
  const { dir, out, r } = scaffold(LOGGING_CONFIG);
  try {
    assert.equal(r.status, 0);
    const rules = readFileSync(join(out, "rules.md"), "utf8");
    assert.match(rules, /Log call-site Classification Rules/);
    assert.match(rules, /"allow", "redact", "remove"/);
    assert.doesNotMatch(rules, /\{\{[A-Z_]+\}\}/);
  } finally { cleanup(dir); }
});

test("e2e: discovery prompt uses the scaffolded id field", () => {
  const { dir, out, r } = scaffold(LOGGING_CONFIG);
  try {
    assert.equal(r.status, 0);
    const prompt = readFileSync(join(out, "prompts/discovery.md"), "utf8");
    assert.match(prompt, /call_site_id/);
    assert.doesNotMatch(prompt, /\{\{[A-Z_]+\}\}/);
  } finally { cleanup(dir); }
});

test("e2e: stamped analysis.schema.json validates a minimal entry", async () => {
  const { default: Ajv2020 } = await import("ajv/dist/2020.js");
  const { default: addFormats } = await import("ajv-formats");
  const { dir, out, r } = scaffold(LOGGING_CONFIG);
  try {
    assert.equal(r.status, 0);
    const schema = JSON.parse(readFileSync(join(out, "analysis.schema.json"), "utf8"));
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(schema);

    const minimalDoc = {
      schema_version: "1.0.0",
      ruleset_version: "2026-04-21",
      run_id: "r1",
      target: "pii-regulated",
      repository: { path: "/repo", commit: "abc" },
      coverage_ref: "./coverage.json",
      entries: [{
        call_site_id: "Foo.java:12",
        name: "log.info at Foo.java:12",
        source: {
          file: "Foo.java", line_start: 12, line_end: 14,
          snippet: "...", snippet_sha256: "a".repeat(64), snippet_normalized_sha256: "a".repeat(64)
        },
        decision: "allow",
        decision_source: "rule",
        rule_fired: "L1",
        rationale: "no PII token in message",
        confidence: "high",
        analysis_status: "complete"
      }]
    };
    assert.ok(validate(minimalDoc), JSON.stringify(validate.errors, null, 2));
  } finally { cleanup(dir); }
});

test("e2e: stamped overrides.schema.json validates a v2 entry with id-field=call_site_id", async () => {
  const { default: Ajv2020 } = await import("ajv/dist/2020.js");
  const { default: addFormats } = await import("ajv-formats");
  const { dir, out, r } = scaffold(LOGGING_CONFIG);
  try {
    assert.equal(r.status, 0);
    const schema = JSON.parse(readFileSync(join(out, "overrides.schema.json"), "utf8"));
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(schema);

    const doc = {
      schema_version: "2.0.0",
      overrides: [{
        call_site_id: "Foo.java:12",
        snippet_normalized_sha256: "a".repeat(64),
        flagged: false,
        decision: "redact",
        stage: "final",
        reviewer: "r@x",
        feedback: [],
        updated_at: "2026-04-21T00:00:00Z"
      }]
    };
    assert.ok(validate(doc), JSON.stringify(validate.errors, null, 2));
  } finally { cleanup(dir); }
});
