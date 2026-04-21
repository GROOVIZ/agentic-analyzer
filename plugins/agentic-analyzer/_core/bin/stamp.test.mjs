import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cli  = join(here, "stamp.mjs");

function tmp() { return mkdtempSync(join(tmpdir(), "stamp-")); }
function cleanup(dir) { rmSync(dir, { recursive: true, force: true }); }
function run(args) { return spawnSync("node", [cli, ...args], { encoding: "utf8" }); }

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

function scaffold(config, template) {
  const dir = tmp();
  const cfg = join(dir, "config.json");
  const tdir = join(dir, "templates");
  const out = join(dir, "out");
  mkdirSync(tdir, { recursive: true });
  writeFileSync(cfg, JSON.stringify(config));
  writeFileSync(join(tdir, "analysis.schema.json.tmpl"), template);
  const r = run([`--config=${cfg}`, `--templates=${tdir}`, `--out=${out}`]);
  return { dir, out, r };
}

test("stamp: replaces simple placeholders and strips .tmpl", () => {
  const tpl = `{ "key": "{{ENTITY_KEY}}", "id": "{{ID_FIELD}}", "target": "{{TARGET_CONST}}" }`;
  const { dir, out, r } = scaffold(CACHES_CONFIG, tpl);
  try {
    assert.equal(r.status, 0, r.stderr);
    const output = readFileSync(join(out, "analysis.schema.json"), "utf8");
    assert.match(output, /"key": "caches"/);
    assert.match(output, /"id": "cache_id"/);
    assert.match(output, /"target": "multi-replica-openshift"/);
  } finally { cleanup(dir); }
});

test("stamp: decision enum placeholders expand with and without null", () => {
  const tpl = `{ "with_null": [{{DECISION_ENUM_WITH_NULL}}], "no_null": [{{DECISION_ENUM_NO_NULL}}] }`;
  const { dir, out, r } = scaffold(CACHES_CONFIG, tpl);
  try {
    assert.equal(r.status, 0, r.stderr);
    const output = readFileSync(join(out, "analysis.schema.json"), "utf8");
    const parsed = JSON.parse(output);
    assert.deepEqual(parsed.with_null, ["retain","externalize","remove", null]);
    assert.deepEqual(parsed.no_null,   ["retain","externalize","remove"]);
  } finally { cleanup(dir); }
});

test("stamp: rule-id lists expand correctly", () => {
  const tpl = `{ "rules": [{{RULE_IDS}}], "with_none": [{{RULE_IDS_WITH_NONE}}] }`;
  const { dir, out, r } = scaffold(LOGGING_CONFIG, tpl);
  try {
    assert.equal(r.status, 0, r.stderr);
    const parsed = JSON.parse(readFileSync(join(out, "analysis.schema.json"), "utf8"));
    assert.deepEqual(parsed.rules, ["L1","L2","L3","L4"]);
    assert.deepEqual(parsed.with_none, ["L1","L2","L3","L4","none"]);
  } finally { cleanup(dir); }
});

test("stamp: unknown placeholder fails with a clear error", () => {
  const tpl = `{ "x": "{{NONSENSE}}" }`;
  const { dir, r } = scaffold(CACHES_CONFIG, tpl);
  try {
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /unknown placeholder/);
  } finally { cleanup(dir); }
});

test("stamp: missing config field fails before writing anything", () => {
  const dir = tmp();
  try {
    const cfg = join(dir, "config.json");
    const tdir = join(dir, "templates");
    const out = join(dir, "out");
    mkdirSync(tdir, { recursive: true });
    writeFileSync(cfg, JSON.stringify({ analyzer_name: "x" })); // missing most fields
    writeFileSync(join(tdir, "noop.tmpl"), "hi");

    const r = run([`--config=${cfg}`, `--templates=${tdir}`, `--out=${out}`]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /config missing/);
    assert.ok(!existsSync(join(out, "noop")), "nothing written on bad config");
  } finally { cleanup(dir); }
});

test("stamp: validates analyzer_name format", () => {
  const dir = tmp();
  try {
    const cfg = join(dir, "config.json");
    const tdir = join(dir, "templates");
    const out = join(dir, "out");
    mkdirSync(tdir, { recursive: true });
    writeFileSync(cfg, JSON.stringify({ ...CACHES_CONFIG, analyzer_name: "Caches With Spaces" }));
    writeFileSync(join(tdir, "x.tmpl"), "x");
    const r = run([`--config=${cfg}`, `--templates=${tdir}`, `--out=${out}`]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /analyzer_name/);
  } finally { cleanup(dir); }
});

test("stamp: files without .tmpl suffix are copied verbatim", () => {
  const dir = tmp();
  try {
    const cfg = join(dir, "config.json");
    const tdir = join(dir, "templates");
    const out = join(dir, "out");
    mkdirSync(tdir, { recursive: true });
    writeFileSync(cfg, JSON.stringify(CACHES_CONFIG));
    writeFileSync(join(tdir, "asset.txt"), "{{ENTITY_KEY}} should NOT be substituted");

    const r = run([`--config=${cfg}`, `--templates=${tdir}`, `--out=${out}`]);
    assert.equal(r.status, 0, r.stderr);
    const content = readFileSync(join(out, "asset.txt"), "utf8");
    assert.match(content, /\{\{ENTITY_KEY\}\}/);
  } finally { cleanup(dir); }
});

test("stamp: preserves subdirectory structure", () => {
  const dir = tmp();
  try {
    const cfg = join(dir, "config.json");
    const tdir = join(dir, "templates");
    const out = join(dir, "out");
    mkdirSync(join(tdir, "schema"), { recursive: true });
    mkdirSync(join(tdir, "prompts"), { recursive: true });
    writeFileSync(cfg, JSON.stringify(CACHES_CONFIG));
    writeFileSync(join(tdir, "schema/a.json.tmpl"), `{"k":"{{ENTITY_KEY}}"}`);
    writeFileSync(join(tdir, "prompts/b.md.tmpl"), `# {{ENTITY_NAME_HUMAN}}`);

    const r = run([`--config=${cfg}`, `--templates=${tdir}`, `--out=${out}`]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(join(out, "schema/a.json")));
    assert.ok(existsSync(join(out, "prompts/b.md")));
    assert.match(readFileSync(join(out, "prompts/b.md"), "utf8"), /# Cache/);
  } finally { cleanup(dir); }
});

test("stamp: real analysis.schema template for caches produces valid JSON", () => {
  const tplPath = join(here, "..", "templates", "analysis.schema.json.tmpl");
  const dir = tmp();
  try {
    const cfg = join(dir, "config.json");
    const tdir = join(dir, "templates");
    const out = join(dir, "out");
    mkdirSync(tdir, { recursive: true });
    writeFileSync(cfg, JSON.stringify(CACHES_CONFIG));
    writeFileSync(join(tdir, "analysis.schema.json.tmpl"), readFileSync(tplPath, "utf8"));

    const r = run([`--config=${cfg}`, `--templates=${tdir}`, `--out=${out}`]);
    assert.equal(r.status, 0, r.stderr);

    const parsed = JSON.parse(readFileSync(join(out, "analysis.schema.json"), "utf8"));
    assert.equal(parsed.title, "Cache analysis result");
    assert.equal(parsed.properties.target.const, "multi-replica-openshift");
    assert.ok(parsed.properties.caches, "stamped entity_key property present");
  } finally { cleanup(dir); }
});

test("stamp: real candidates.schema template for logging produces valid JSON", () => {
  const tplPath = join(here, "..", "templates", "candidates.schema.json.tmpl");
  const dir = tmp();
  try {
    const cfg = join(dir, "config.json");
    const tdir = join(dir, "templates");
    const out = join(dir, "out");
    mkdirSync(tdir, { recursive: true });
    writeFileSync(cfg, JSON.stringify(LOGGING_CONFIG));
    writeFileSync(join(tdir, "candidates.schema.json.tmpl"), readFileSync(tplPath, "utf8"));

    const r = run([`--config=${cfg}`, `--templates=${tdir}`, `--out=${out}`]);
    assert.equal(r.status, 0, r.stderr);

    const parsed = JSON.parse(readFileSync(join(out, "candidates.schema.json"), "utf8"));
    assert.equal(parsed.title, "Log call-site candidates (intermediate discovery output)");
    assert.equal(parsed.properties.candidates.items.required[0], "call_site_id");
  } finally { cleanup(dir); }
});

test("stamp: refuses to overwrite an existing output directory without --force", () => {
  const dir = tmp();
  try {
    const cfg = join(dir, "config.json");
    const tdir = join(dir, "templates");
    const out = join(dir, "out");
    mkdirSync(tdir, { recursive: true });
    mkdirSync(out); // pre-exists
    writeFileSync(cfg, JSON.stringify(CACHES_CONFIG));
    writeFileSync(join(tdir, "x.tmpl"), "x");

    const r = run([`--config=${cfg}`, `--templates=${tdir}`, `--out=${out}`]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /output path exists/);
  } finally { cleanup(dir); }
});

test("stamp: atomic — failure mid-stamp leaves no partial output", () => {
  const dir = tmp();
  try {
    const cfg = join(dir, "config.json");
    const tdir = join(dir, "templates");
    const out = join(dir, "out");
    mkdirSync(tdir, { recursive: true });
    writeFileSync(cfg, JSON.stringify(CACHES_CONFIG));
    writeFileSync(join(tdir, "good.tmpl"), `{"k":"{{ENTITY_KEY}}"}`);
    writeFileSync(join(tdir, "bad.tmpl"),  `{"k":"{{NONSENSE}}"}`); // will blow up

    const r = run([`--config=${cfg}`, `--templates=${tdir}`, `--out=${out}`]);
    assert.notEqual(r.status, 0, "stamp should fail");
    assert.ok(!existsSync(out), "no partial output should remain on failure");

    // Also: no leftover staging dirs.
    const siblings = readdirSync(dir);
    const staging = siblings.filter(s => s.startsWith("out.staging-"));
    assert.deepEqual(staging, [], `leftover staging dirs: ${staging.join(", ")}`);
  } finally { cleanup(dir); }
});

test("stamp: requires_serena=false replaces SERENA_PREREQ with the soft-degrade phrasing", () => {
  const tpl = `prereq: {{SERENA_PREREQ}}`;
  const dir = tmp();
  try {
    const cfg = join(dir, "config.json");
    const tdir = join(dir, "templates");
    const out = join(dir, "out");
    mkdirSync(tdir, { recursive: true });
    writeFileSync(cfg, JSON.stringify({ ...LOGGING_CONFIG, requires_serena: false }));
    writeFileSync(join(tdir, "x.md.tmpl"), tpl);
    const r = run([`--config=${cfg}`, `--templates=${tdir}`, `--out=${out}`]);
    assert.equal(r.status, 0, r.stderr);
    const content = readFileSync(join(out, "x.md"), "utf8");
    assert.match(content, /record `serena_available: false`/);
    assert.doesNotMatch(content, /stop immediately/i);
  } finally { cleanup(dir); }
});

test("stamp: requires_serena defaults to true when omitted", () => {
  const tpl = `prereq: {{SERENA_PREREQ}}`;
  const dir = tmp();
  try {
    const cfg = join(dir, "config.json");
    const tdir = join(dir, "templates");
    const out = join(dir, "out");
    mkdirSync(tdir, { recursive: true });
    writeFileSync(cfg, JSON.stringify(LOGGING_CONFIG)); // no requires_serena
    writeFileSync(join(tdir, "x.md.tmpl"), tpl);
    const r = run([`--config=${cfg}`, `--templates=${tdir}`, `--out=${out}`]);
    assert.equal(r.status, 0, r.stderr);
    const content = readFileSync(join(out, "x.md"), "utf8");
    assert.match(content, /stop immediately/i);
  } finally { cleanup(dir); }
});

test("stamp: requires_context7=false softens the Context7 prereq", () => {
  const tpl = `prereq: {{CONTEXT7_PREREQ}}`;
  const dir = tmp();
  try {
    const cfg = join(dir, "config.json");
    const tdir = join(dir, "templates");
    const out = join(dir, "out");
    mkdirSync(tdir, { recursive: true });
    // Default for context7 is true (hard-fail); set explicitly false to soften.
    writeFileSync(cfg, JSON.stringify({ ...LOGGING_CONFIG, requires_context7: false }));
    writeFileSync(join(tdir, "x.md.tmpl"), tpl);
    const r = run([`--config=${cfg}`, `--templates=${tdir}`, `--out=${out}`]);
    assert.equal(r.status, 0, r.stderr);
    const content = readFileSync(join(out, "x.md"), "utf8");
    assert.match(content, /continue but record `context7_available: false`/);
  } finally { cleanup(dir); }
});

test("stamp: real overrides.schema template for logging produces valid JSON", () => {
  const tplPath = join(here, "..", "templates", "overrides.schema.json.tmpl");
  const dir = tmp();
  try {
    const cfg = join(dir, "config.json");
    const tdir = join(dir, "templates");
    const out = join(dir, "out");
    mkdirSync(tdir, { recursive: true });
    writeFileSync(cfg, JSON.stringify(LOGGING_CONFIG));
    writeFileSync(join(tdir, "overrides.schema.json.tmpl"), readFileSync(tplPath, "utf8"));

    const r = run([`--config=${cfg}`, `--templates=${tdir}`, `--out=${out}`]);
    assert.equal(r.status, 0, r.stderr);

    const parsed = JSON.parse(readFileSync(join(out, "overrides.schema.json"), "utf8"));
    assert.equal(parsed.properties.schema_version.const, "2.0.0");
    // required[] includes the logging-specific id field
    assert.ok(parsed.properties.overrides.items.required.includes("call_site_id"));
  } finally { cleanup(dir); }
});

test("stamp: each new required key fails when omitted", () => {
  const base = { ...LOGGING_CONFIG };
  for (const key of ["language", "frameworks", "source_roots", "manifest_list", "target_question"]) {
    const dir = tmp();
    try {
      const cfg = join(dir, "config.json");
      const tdir = join(dir, "templates");
      const out = join(dir, "out");
      mkdirSync(tdir, { recursive: true });
      const broken = { ...base };
      delete broken[key];
      writeFileSync(cfg, JSON.stringify(broken));
      writeFileSync(join(tdir, "noop.tmpl"), "hi");
      const r = run([`--config=${cfg}`, `--templates=${tdir}`, `--out=${out}`]);
      assert.notEqual(r.status, 0, `omitting ${key} should fail`);
      assert.match(r.stderr, new RegExp(`config missing: ${key}`), `stderr: ${r.stderr}`);
    } finally { cleanup(dir); }
  }
});

test("stamp: new array/string keys fail when empty or malformed", () => {
  const cases = [
    { key: "frameworks",      bad: "not-an-array", expect: /frameworks must be an array/ },
    { key: "source_roots",    bad: [],             expect: /source_roots must be a non-empty array/ },
    { key: "source_roots",    bad: [""],           expect: /source_roots must be a non-empty array of non-empty strings/ },
    { key: "manifest_list",   bad: [],             expect: /manifest_list must be a non-empty array/ },
    { key: "manifest_list",   bad: [42],           expect: /manifest_list must be a non-empty array of non-empty strings/ },
    { key: "language",        bad: "Java",         expect: /language must match/ },
    { key: "target_question", bad: "",             expect: /target_question must be a non-empty string/ }
  ];
  for (const c of cases) {
    const dir = tmp();
    try {
      const cfg = join(dir, "config.json");
      const tdir = join(dir, "templates");
      const out = join(dir, "out");
      mkdirSync(tdir, { recursive: true });
      writeFileSync(cfg, JSON.stringify({ ...LOGGING_CONFIG, [c.key]: c.bad }));
      writeFileSync(join(tdir, "noop.tmpl"), "hi");
      const r = run([`--config=${cfg}`, `--templates=${tdir}`, `--out=${out}`]);
      assert.notEqual(r.status, 0, `${c.key}=${JSON.stringify(c.bad)} should fail`);
      assert.match(r.stderr, c.expect, `stderr: ${r.stderr}`);
    } finally { cleanup(dir); }
  }
});

test("stamp: identity_convention defaults when omitted", () => {
  const tpl = `convention: {{IDENTITY_CONVENTION}}`;
  const dir = tmp();
  try {
    const cfg = join(dir, "config.json");
    const tdir = join(dir, "templates");
    const out = join(dir, "out");
    mkdirSync(tdir, { recursive: true });
    writeFileSync(cfg, JSON.stringify(LOGGING_CONFIG));
    writeFileSync(join(tdir, "x.md.tmpl"), tpl);
    const r = run([`--config=${cfg}`, `--templates=${tdir}`, `--out=${out}`]);
    assert.equal(r.status, 0, r.stderr);
    const content = readFileSync(join(out, "x.md"), "utf8");
    assert.match(content, /<lang>:<rel>:<class>\.<method>:<name>/);
  } finally { cleanup(dir); }
});

test("stamp: identity_convention honours an explicit value", () => {
  const tpl = `convention: {{IDENTITY_CONVENTION}}`;
  const dir = tmp();
  try {
    const cfg = join(dir, "config.json");
    const tdir = join(dir, "templates");
    const out = join(dir, "out");
    mkdirSync(tdir, { recursive: true });
    writeFileSync(cfg, JSON.stringify({ ...LOGGING_CONFIG, identity_convention: "py:<rel>:<module>.<func>" }));
    writeFileSync(join(tdir, "x.md.tmpl"), tpl);
    const r = run([`--config=${cfg}`, `--templates=${tdir}`, `--out=${out}`]);
    assert.equal(r.status, 0, r.stderr);
    const content = readFileSync(join(out, "x.md"), "utf8");
    assert.match(content, /py:<rel>:<module>\.<func>/);
  } finally { cleanup(dir); }
});

test("stamp: phase_c_hint defaults when omitted", () => {
  const tpl = `hint: {{PHASE_C_HINT}}`;
  const dir = tmp();
  try {
    const cfg = join(dir, "config.json");
    const tdir = join(dir, "templates");
    const out = join(dir, "out");
    mkdirSync(tdir, { recursive: true });
    writeFileSync(cfg, JSON.stringify(LOGGING_CONFIG));
    writeFileSync(join(tdir, "x.md.tmpl"), tpl);
    const r = run([`--config=${cfg}`, `--templates=${tdir}`, `--out=${out}`]);
    assert.equal(r.status, 0, r.stderr);
    const content = readFileSync(join(out, "x.md"), "utf8");
    assert.match(content, /no config-driven candidates detected/i);
  } finally { cleanup(dir); }
});

test("stamp: identity_convention rejects empty string and non-string", () => {
  for (const bad of ["", 42, null]) {
    const dir = tmp();
    try {
      const cfg = join(dir, "config.json");
      const tdir = join(dir, "templates");
      const out = join(dir, "out");
      mkdirSync(tdir, { recursive: true });
      writeFileSync(cfg, JSON.stringify({ ...LOGGING_CONFIG, identity_convention: bad }));
      writeFileSync(join(tdir, "x.tmpl"), "x");
      const r = run([`--config=${cfg}`, `--templates=${tdir}`, `--out=${out}`]);
      assert.notEqual(r.status, 0, `identity_convention=${JSON.stringify(bad)} should fail`);
      assert.match(r.stderr, /identity_convention must be a non-empty string/, `stderr: ${r.stderr}`);
    } finally { cleanup(dir); }
  }
});

test("stamp: phase_c_hint rejects non-string", () => {
  for (const bad of [42, null, ["array"]]) {
    const dir = tmp();
    try {
      const cfg = join(dir, "config.json");
      const tdir = join(dir, "templates");
      const out = join(dir, "out");
      mkdirSync(tdir, { recursive: true });
      writeFileSync(cfg, JSON.stringify({ ...LOGGING_CONFIG, phase_c_hint: bad }));
      writeFileSync(join(tdir, "x.tmpl"), "x");
      const r = run([`--config=${cfg}`, `--templates=${tdir}`, `--out=${out}`]);
      assert.notEqual(r.status, 0, `phase_c_hint=${JSON.stringify(bad)} should fail`);
      assert.match(r.stderr, /phase_c_hint must be a string/, `stderr: ${r.stderr}`);
    } finally { cleanup(dir); }
  }
});

test("stamp: phase_c_hint accepts empty string (intentional asymmetry vs identity_convention)", () => {
  const tpl = `hint: '{{PHASE_C_HINT}}'`;
  const dir = tmp();
  try {
    const cfg = join(dir, "config.json");
    const tdir = join(dir, "templates");
    const out = join(dir, "out");
    mkdirSync(tdir, { recursive: true });
    writeFileSync(cfg, JSON.stringify({ ...LOGGING_CONFIG, phase_c_hint: "" }));
    writeFileSync(join(tdir, "x.md.tmpl"), tpl);
    const r = run([`--config=${cfg}`, `--templates=${tdir}`, `--out=${out}`]);
    assert.equal(r.status, 0, r.stderr);
    const content = readFileSync(join(out, "x.md"), "utf8");
    assert.match(content, /^hint: ''$/m);
  } finally { cleanup(dir); }
});

test("stamp: language/framework/manifest/source-root/target-question tokens substitute", () => {
  const tpl = [
    "language: {{LANGUAGE}}",
    "frameworks: [{{FRAMEWORK_LIST}}]",
    "regex: {{FRAMEWORK_REGEX}}",
    "manifests: [{{MANIFEST_LIST}}]",
    "source_roots: [{{SOURCE_ROOTS}}]",
    "question: {{TARGET_QUESTION}}"
  ].join("\n");
  const dir = tmp();
  try {
    const cfg = join(dir, "config.json");
    const tdir = join(dir, "templates");
    const out = join(dir, "out");
    mkdirSync(tdir, { recursive: true });
    writeFileSync(cfg, JSON.stringify(LOGGING_CONFIG));
    writeFileSync(join(tdir, "x.md.tmpl"), tpl);
    const r = run([`--config=${cfg}`, `--templates=${tdir}`, `--out=${out}`]);
    assert.equal(r.status, 0, r.stderr);
    const content = readFileSync(join(out, "x.md"), "utf8");
    assert.match(content, /language: java/);
    assert.match(content, /frameworks: \["slf4j", "logback"\]/);
    assert.match(content, /regex: \/\(slf4j\|logback\)\/i/);
    assert.match(content, /manifests: \["pom\.xml", "build\.gradle", "build\.gradle\.kts"\]/);
    assert.match(content, /source_roots: \["src\/main\/java"\]/);
    assert.match(content, /question: Should this log call be allowed under PII rules\?/);
  } finally { cleanup(dir); }
});

test("stamp: framework_regex emits a never-matching regex for an empty list", () => {
  const tpl = `regex: {{FRAMEWORK_REGEX}}`;
  const dir = tmp();
  try {
    const cfg = join(dir, "config.json");
    const tdir = join(dir, "templates");
    const out = join(dir, "out");
    mkdirSync(tdir, { recursive: true });
    writeFileSync(cfg, JSON.stringify({ ...LOGGING_CONFIG, frameworks: [] }));
    writeFileSync(join(tdir, "x.md.tmpl"), tpl);
    const r = run([`--config=${cfg}`, `--templates=${tdir}`, `--out=${out}`]);
    assert.equal(r.status, 0, r.stderr);
    const content = readFileSync(join(out, "x.md"), "utf8");
    assert.match(content, /regex: \/\(\?!\)\/i/, content);
  } finally { cleanup(dir); }
});
