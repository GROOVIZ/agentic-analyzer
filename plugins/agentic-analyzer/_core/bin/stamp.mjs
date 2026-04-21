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
//   {
//     "analyzer_name":        "caches",
//     "entity_name_human":    "Cache",
//     "entity_key":           "caches",
//     "id_field":             "cache_id",
//     "target_const":         "multi-replica-openshift",
//     "decision_enum":        ["retain", "externalize", "remove"],
//     "rule_ids":             ["R1","R2", ... ,"R11"]
//   }
//
// Placeholders derived from the config:
//   {{ANALYZER_NAME}}           caches
//   {{ENTITY_NAME_HUMAN}}       Cache
//   {{ENTITY_KEY}}              caches
//   {{ID_FIELD}}                cache_id
//   {{TARGET_CONST}}            multi-replica-openshift
//   {{DECISION_ENUM_NO_NULL}}   "retain", "externalize", "remove"
//   {{DECISION_ENUM_WITH_NULL}} "retain", "externalize", "remove", null
//   {{RULE_IDS}}                "R1", "R2", ..., "R11"
//   {{RULE_IDS_WITH_NONE}}      "R1", "R2", ..., "R11", "none"
//   {{SERENA_PREREQ}}           SKILL.md paragraph — hard-fail or soft-degrade
//   {{CONTEXT7_PREREQ}}         SKILL.md paragraph — hard-fail or soft-degrade
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
                  "target_const", "decision_enum", "rule_ids"];
for (const k of required) {
  if (config[k] === undefined) { stderr.write(`config missing: ${k}\n`); exit(1); }
}
// Optional, with documented defaults.
if (config.requires_serena === undefined) config.requires_serena = true;
if (config.requires_context7 === undefined) config.requires_context7 = true;
if (typeof config.requires_serena !== "boolean") { stderr.write("requires_serena must be boolean\n"); exit(1); }
if (typeof config.requires_context7 !== "boolean") { stderr.write("requires_context7 must be boolean\n"); exit(1); }
if (!Array.isArray(config.decision_enum) || config.decision_enum.length === 0) {
  stderr.write("decision_enum must be a non-empty array\n"); exit(1);
}
if (!Array.isArray(config.rule_ids) || config.rule_ids.length === 0
    || !config.rule_ids.every(v => typeof v === "string" && v.length > 0)) {
  stderr.write("rule_ids must be a non-empty array of non-empty strings\n"); exit(1);
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
  CONTEXT7_PREREQ:        config.requires_context7 ? CTX7_HARD   : CTX7_SOFT
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
