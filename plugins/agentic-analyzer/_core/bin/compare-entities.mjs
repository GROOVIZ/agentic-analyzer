import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { argv, exit, stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parseArgs } from "./_args.mjs";

// Compare a dev-team "expected entities" oracle against the latest
// analysis.json to surface discovery and classification gaps.
//
// Consumed file shape (see _core/schema/expected-entities.schema.json):
//   { "schema_version": "1.0.0", "entities": [ { "name": "...", "expected_decision"?: "..." } ] }
//
// Matching: an analyzer entry matches a name when its id_field value ends
// with `":<name>"`. The colon boundary avoids false positives on longer
// suffixes (e.g., expected "foo" does NOT match id ":barfoo"). Pass
// --case-insensitive to relax the match.
//
// Report sections:
//   MISSED               name in list, zero matching entries
//   AMBIGUOUS            name in list, 2+ matching entries
//   DECISION-MISMATCH    name in list with expected_decision, matching
//                        entry has a different decision
//
// Exit codes:
//   0 — every name resolved cleanly
//   1 — at least one gap found
//   2 — usage error / bad input

const { flags, positional } = parseArgs(argv);
const usage = "usage: node compare-entities.mjs <expected-entities.json> <analysis.json> --entity-key=<k> --id-field=<f> [--decision-field=<f>] [--case-insensitive]\n";

if (positional.length !== 2) { stderr.write(usage); exit(2); }
if (!flags["entity-key"])    { stderr.write("--entity-key is required\n" + usage); exit(2); }
if (!flags["id-field"])      { stderr.write("--id-field is required\n"    + usage); exit(2); }

const [expectedPath, analysisPath] = positional;
const entityKey     = flags["entity-key"];
const idField       = flags["id-field"];
const decisionField = flags["decision-field"] ?? "decision";
const caseInsensitive = Boolean(flags["case-insensitive"]);

if (!existsSync(expectedPath)) {
  stderr.write(`expected-entities file not found: ${expectedPath}\n`);
  exit(2);
}
if (!existsSync(analysisPath)) {
  stderr.write(`analysis.json not found: ${analysisPath}\n`);
  exit(2);
}

let expectedDoc, analysisDoc;
try { expectedDoc = JSON.parse(readFileSync(expectedPath, "utf8")); }
catch (e) { stderr.write(`expected-entities parse failed: ${e.message}\n`); exit(2); }
try { analysisDoc = JSON.parse(readFileSync(analysisPath, "utf8")); }
catch (e) { stderr.write(`analysis.json parse failed: ${e.message}\n`);   exit(2); }

// Schema-validate the expected-entities file. The analysis.json is already
// validated upstream by the analyzer's own schema.
const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "..", "schema", "expected-entities.schema.json");
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schema);
if (!validate(expectedDoc)) {
  stderr.write("expected-entities schema validation failed:\n");
  for (const err of validate.errors) {
    stderr.write(`  ${err.instancePath || "/"} ${err.message}\n`);
  }
  exit(2);
}

const expected = expectedDoc.entities;
const entries  = analysisDoc[entityKey] ?? [];

// Post-parse linter: flag names that look like ingestor drift. The
// canonical schema accepts any non-empty string for `name`; this check
// adds a defensive layer against hallucinated or mis-parsed entries.
// Never changes exit status — warnings only.
const ALLOWED_NAME_RE = /^[A-Za-z0-9_.:\-]+$/;
const NAME_LEN_CAP    = 64;
const suspicious = [];
for (const e of expected) {
  const reasons = [];
  if (/\s/.test(e.name)) reasons.push("contains whitespace");
  if (!ALLOWED_NAME_RE.test(e.name)) reasons.push("punctuation outside [A-Za-z0-9_.:-]");
  if (e.name.length > NAME_LEN_CAP) reasons.push(`too long (>${NAME_LEN_CAP} chars)`);
  if (reasons.length) suspicious.push({ entity: e, reasons });
}

const fold = s => caseInsensitive ? s.toLowerCase() : s;

// Build a list of (name → matching entries) using endsWith(":"+name).
const matches = new Map();
for (const e of expected) {
  const needle = ":" + fold(e.name);
  const hits = entries.filter(a => {
    const id = a[idField];
    return typeof id === "string" && fold(id).endsWith(needle);
  });
  matches.set(e.name, { entity: e, hits });
}

const missed = [];
const ambiguous = [];
const mismatches = [];
let matched = 0;

for (const { entity, hits } of matches.values()) {
  if (hits.length === 0) {
    missed.push(entity);
  } else if (hits.length > 1) {
    ambiguous.push({ entity, hits });
  } else {
    matched++;
    const actual = hits[0];
    if (entity.expected_decision !== undefined &&
        actual[decisionField] !== entity.expected_decision) {
      mismatches.push({ entity, actual });
    }
  }
}

const lines = [];
lines.push(`compare-entities: ${expected.length} expected, ${matched} matched, ${missed.length} missed, ${ambiguous.length} ambiguous, ${mismatches.length} decision-mismatched, ${suspicious.length} suspicious`);

if (suspicious.length) {
  lines.push("");
  lines.push(`SUSPICIOUS (${suspicious.length}) — name(s) look unusual; possible ingestor drift:`);
  for (const { entity, reasons } of suspicious) {
    lines.push(`  - ${entity.name}  (${reasons.join("; ")})`);
  }
}

if (missed.length) {
  lines.push("");
  lines.push(`MISSED (${missed.length}) — in expected list, no analyzer entry:`);
  for (const e of missed) lines.push(`  - ${e.name}`);
}

if (ambiguous.length) {
  lines.push("");
  lines.push(`AMBIGUOUS (${ambiguous.length}) — name matches multiple analyzer entries:`);
  for (const { entity, hits } of ambiguous) {
    lines.push(`  - ${entity.name}`);
    for (const h of hits) lines.push(`      ${h[idField]}`);
  }
}

if (mismatches.length) {
  lines.push("");
  lines.push(`DECISION-MISMATCH (${mismatches.length}) — expected_decision differs from analyzer output:`);
  for (const { entity, actual } of mismatches) {
    lines.push(`  - ${entity.name}: expected ${entity.expected_decision}, got ${actual[decisionField]}  (${actual[idField]})`);
  }
}

stdout.write(lines.join("\n") + "\n");
exit(missed.length + ambiguous.length + mismatches.length === 0 ? 0 : 1);
