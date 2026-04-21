import { readFileSync, writeFileSync, readdirSync, lstatSync, mkdirSync, existsSync, renameSync, rmSync } from "node:fs";
import { join, dirname, relative, resolve, sep } from "node:path";
import { argv, exit, stderr, stdout } from "node:process";
import { randomBytes } from "node:crypto";
import { parseArgs } from "./_args.mjs";

// Template stamping engine.
//
// Reads a domain config (JSON) and a templates directory, and emits a
// scaffolded analyzer directory with {{PLACEHOLDER}} tokens replaced and the
// `.tmpl` suffix stripped.
//
// Config shape (validated inline):
//   Required (12):
//     "analyzer_name"       — kebab/snake lower-case identifier for the analyzer
//     "entity_name_human"   — human-readable entity name (e.g. "Cache")
//     "entity_key"          — snake_case plural used as the JSON array key
//     "id_field"            — snake_case field name that identifies each entity
//     "target_const"        — the fixed "target" string stamped into schemas
//     "decision_enum"       — non-empty array of decision strings (no null)
//     "rule_ids"            — non-empty array of stable rule ID strings
//     "language"            — primary language slug (e.g. "java", "typescript")
//     "frameworks"          — array of framework/library names (may be empty)
//     "source_roots"        — non-empty array of source root paths to scan
//     "manifest_list"       — non-empty array of manifest file names
//     "target_question"     — one-sentence question the analyzer answers
//   Optional (with defaults):
//     "requires_serena"       — boolean (default: true) — hard-fail if Serena absent
//     "requires_context7"     — boolean (default: true) — hard-fail if Context7 absent
//     "identity_convention"   — string (default: per-language pattern) — how entity IDs are formed
//     "phase_c_hint"          — string (default prose) — config-driven candidate hint in SKILL.md
//
// Placeholders derived from the config:
//   {{ANALYZER_NAME}}           analyzer_name verbatim (e.g. "logging")
//   {{ENTITY_NAME_HUMAN}}       entity_name_human verbatim (e.g. "Log call-site")
//   {{ENTITY_KEY}}              entity_key verbatim (e.g. "entries")
//   {{ID_FIELD}}                id_field verbatim (e.g. "call_site_id")
//   {{TARGET_CONST}}            target_const verbatim (e.g. "pii-regulated")
//   {{DECISION_ENUM_NO_NULL}}   quoted, comma-joined decision values without null
//   {{DECISION_ENUM_WITH_NULL}} quoted, comma-joined decision values with trailing null
//   {{RULE_IDS}}                quoted, comma-joined rule_ids
//   {{RULE_IDS_WITH_NONE}}      quoted, comma-joined rule_ids plus "none"
//   {{SERENA_PREREQ}}           SKILL.md prose paragraph — hard-fail or soft-degrade
//   {{CONTEXT7_PREREQ}}         SKILL.md prose paragraph — hard-fail or soft-degrade
//   {{LANGUAGE}}                language verbatim (e.g. "java")
//   {{FRAMEWORK_LIST}}          quoted, comma-joined frameworks
//   {{FRAMEWORK_REGEX}}         JS regex literal that matches any framework name
//   {{MANIFEST_LIST}}           quoted, comma-joined manifest_list entries
//   {{SOURCE_ROOTS}}            quoted, comma-joined source_roots entries
//   {{TARGET_QUESTION}}         target_question verbatim (the one-sentence question)
//   {{IDENTITY_CONVENTION}}     identity_convention verbatim or per-language default
//   {{PHASE_C_HINT}}            phase_c_hint verbatim or default prose block
//
// Placeholder grammar is `{{[A-Z0-9_]+}}`. Unknown tokens are hard errors.
//
// Usage:
//   node stamp.mjs --config=<path> --templates=<dir> --out=<dir> [--force]

const { flags } = parseArgs(argv);
const usage = "usage: node stamp.mjs --config=<path> --templates=<dir> --out=<dir> [--force]\n";
for (const req of ["config", "templates", "out"]) {
  if (!flags[req]) { stderr.write(usage); exit(2); }
}

let config;
try { config = JSON.parse(readFileSync(flags.config, "utf8")); }
catch (e) { stderr.write(`config parse: ${e.message}\n`); exit(1); }

const required = ["analyzer_name", "entity_name_human", "entity_key", "id_field",
                  "target_const", "decision_enum", "rule_ids",
                  "language", "frameworks", "source_roots", "manifest_list",
                  "target_question"];
for (const k of required) {
  if (config[k] === undefined) { stderr.write(`config missing: ${k}\n`); exit(1); }
}
// Prose-block defaults for optional config keys.
const DEFAULT_PHASE_C_HINT = "No config-driven candidates detected at scaffold time. Delete this section if your domain has no ad-hoc or config-driven candidates; otherwise fill in what to correlate.";

// Optional, with documented defaults.
if (config.requires_serena === undefined) config.requires_serena = true;
if (config.requires_context7 === undefined) config.requires_context7 = true;
if (typeof config.requires_serena !== "boolean") { stderr.write("requires_serena must be boolean\n"); exit(1); }
if (typeof config.requires_context7 !== "boolean") { stderr.write("requires_context7 must be boolean\n"); exit(1); }
if (config.identity_convention === undefined) {
  config.identity_convention = "<lang>:<rel>:<class>.<method>:<name>";
}
if (typeof config.identity_convention !== "string" || config.identity_convention.length === 0) {
  stderr.write("identity_convention must be a non-empty string\n"); exit(1);
}
if (config.phase_c_hint === undefined) config.phase_c_hint = DEFAULT_PHASE_C_HINT;
if (typeof config.phase_c_hint !== "string") {
  stderr.write("phase_c_hint must be a string\n"); exit(1);
}
if (!Array.isArray(config.decision_enum) || config.decision_enum.length === 0) {
  stderr.write("decision_enum must be a non-empty array\n"); exit(1);
}
if (!Array.isArray(config.rule_ids) || config.rule_ids.length === 0
    || !config.rule_ids.every(v => typeof v === "string" && v.length > 0)) {
  stderr.write("rule_ids must be a non-empty array of non-empty strings\n"); exit(1);
}
if (typeof config.language !== "string" || !/^[a-z][a-z0-9+-]*$/.test(config.language)) {
  stderr.write("language must match /^[a-z][a-z0-9+-]*$/\n"); exit(1);
}
if (!Array.isArray(config.frameworks)
    || !config.frameworks.every(v => typeof v === "string" && v.length > 0)) {
  stderr.write("frameworks must be an array of non-empty strings\n"); exit(1);
}
if (!Array.isArray(config.source_roots) || config.source_roots.length === 0
    || !config.source_roots.every(v => typeof v === "string" && v.length > 0)) {
  stderr.write("source_roots must be a non-empty array of non-empty strings\n"); exit(1);
}
if (!Array.isArray(config.manifest_list) || config.manifest_list.length === 0
    || !config.manifest_list.every(v => typeof v === "string" && v.length > 0)) {
  stderr.write("manifest_list must be a non-empty array of non-empty strings\n"); exit(1);
}
if (typeof config.target_question !== "string" || config.target_question.length === 0) {
  stderr.write("target_question must be a non-empty string\n"); exit(1);
}
if (!/^[a-z][a-z0-9_-]*$/.test(config.analyzer_name)) {
  stderr.write("analyzer_name must be kebab/snake lower-case\n"); exit(1);
}
if (!/^[a-z_][a-z0-9_]*$/.test(config.entity_key)) {
  stderr.write("entity_key must be snake_case lower\n"); exit(1);
}
if (!/^[a-z_][a-z0-9_]*$/.test(config.id_field)) {
  stderr.write("id_field must be snake_case lower\n"); exit(1);
}

const quote = s => `"${String(s).replace(/"/g, '\\"')}"`;
const enumList = (arr, { withNull = false } = {}) =>
  [...arr.map(quote), ...(withNull ? ["null"] : [])].join(", ");
const frameworkRegex = (frameworks) => {
  if (!frameworks.length) return "/(?!)/i";
  const alternation = frameworks.map(f => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return `/(${alternation})/i`;
};

// Substitution blocks for the MCP-prereq paragraphs. These are prose
// fragments injected into SKILL.md; the author can freely edit them
// after scaffolding.
const SERENA_HARD = `Check Serena MCP availability. If Serena tools are not present, **stop immediately** with: *"Serena MCP is required. Install and enable the Serena plugin before running /analyze-${config.analyzer_name}."*`;
const SERENA_SOFT = `Check Serena MCP availability. If Serena tools are not present, record \`serena_available: false\` in coverage, add a \`degradations[]\` entry (stage \`"serena"\`, reason \`"plugin unavailable"\`), and proceed with Glob/Grep-only discovery. This analyzer does not require symbolic enumeration.`;
const CTX7_HARD   = `Check Context7 MCP availability. If Context7 tools are not present, **stop immediately** with: *"Context7 MCP is required. Install and enable the Context7 plugin before running /analyze-${config.analyzer_name}."*`;
const CTX7_SOFT   = `Check Context7 MCP availability. If unavailable, continue but record \`context7_available: false\` in coverage and add a \`degradations[]\` entry (stage \`"context7"\`, reason \`"plugin unavailable"\`).`;

const substitutions = {
  ANALYZER_NAME:          config.analyzer_name,
  ENTITY_NAME_HUMAN:      config.entity_name_human,
  ENTITY_KEY:             config.entity_key,
  ID_FIELD:               config.id_field,
  TARGET_CONST:           config.target_const,
  DECISION_ENUM_NO_NULL:  enumList(config.decision_enum),
  DECISION_ENUM_WITH_NULL:enumList(config.decision_enum, { withNull: true }),
  RULE_IDS:               enumList(config.rule_ids),
  RULE_IDS_WITH_NONE:     enumList([...config.rule_ids, "none"]),
  SERENA_PREREQ:          config.requires_serena   ? SERENA_HARD : SERENA_SOFT,
  CONTEXT7_PREREQ:        config.requires_context7 ? CTX7_HARD   : CTX7_SOFT,
  LANGUAGE:               config.language,
  FRAMEWORK_LIST:         enumList(config.frameworks),
  FRAMEWORK_REGEX:        frameworkRegex(config.frameworks),
  MANIFEST_LIST:          enumList(config.manifest_list),
  SOURCE_ROOTS:           enumList(config.source_roots),
  TARGET_QUESTION:        config.target_question,
  IDENTITY_CONVENTION:    config.identity_convention,
  PHASE_C_HINT:           config.phase_c_hint
};

function stamp(text) {
  return text.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key) => {
    if (!(key in substitutions)) {
      throw new Error(`unknown placeholder: {{${key}}}`);
    }
    return substitutions[key];
  });
}

function walk(dir, fn) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) {
      stderr.write(`refusing to follow symlink in templates: ${p}\n`); exit(1);
    }
    if (st.isDirectory()) walk(p, fn);
    else if (st.isFile()) fn(p);
    else {
      stderr.write(`refusing non-regular file in templates: ${p}\n`); exit(1);
    }
  }
}

const templatesDir = resolve(flags.templates);
const outDir = resolve(flags.out);

if (existsSync(outDir) && !flags.force) {
  stderr.write(`output path exists: ${outDir}\n(use --force to allow stamping into an existing parent, but beware it will not clean up stale files)\n`);
  exit(1);
}

// Stage to a sibling temp dir and rename at the end. That way a failure
// leaves zero partial state under outDir — the author can retry cleanly.
const stagingDir = `${outDir}.staging-${randomBytes(6).toString("hex")}`;
const stagingPrefix = stagingDir + sep;

let stamped = 0;
try {
  walk(templatesDir, (src) => {
    const rel = relative(templatesDir, src);
    const dstRel = rel.endsWith(".tmpl") ? rel.slice(0, -".tmpl".length) : rel;
    const dstInStaging = resolve(stagingDir, dstRel);

    // Path-escape defense against malicious `..` segments in template names.
    // Checking the staging path is sufficient — the final path is produced
    // by the atomic rename from stagingDir to outDir, so any layout that
    // stays under stagingDir will stay under outDir after the swap.
    if (!dstInStaging.startsWith(stagingPrefix) && dstInStaging !== stagingDir) {
      throw new Error(`path escape detected: ${dstRel}`);
    }

    const content = readFileSync(src, "utf8");
    const out = rel.endsWith(".tmpl") ? stamp(content) : content;
    mkdirSync(dirname(dstInStaging), { recursive: true });
    writeFileSync(dstInStaging, out, "utf8");
    stamped++;
  });
} catch (e) {
  rmSync(stagingDir, { recursive: true, force: true });
  stderr.write(`stamp failed: ${e.message}\n`);
  exit(1);
}

// Atomic swap. If outDir pre-exists (only possible with --force), remove it
// first; otherwise we fall through to a clean rename.
if (existsSync(outDir)) {
  rmSync(outDir, { recursive: true, force: true });
}
mkdirSync(dirname(outDir), { recursive: true });
renameSync(stagingDir, outDir);

stdout.write(`stamped ${stamped} file(s) into ${outDir}\n`);
exit(0);
