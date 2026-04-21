import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { argv, exit, stderr, stdout } from "node:process";
import { parseArgs } from "./_args.mjs";

// Generic fixture comparator for any agentic-analyzer instance.
//
// Reads <fixture-dir>/expected.json:
//   {
//     "expected":  [{ "<id_field>": "...", "<decision_field>": "...", "<rule_field>": "..." }, ...],
//     "forbidden": ["<id>", ...]
//   }
//
// Reads <fixture-dir>/actual/<artifact>:
//   { "<entity_key>": [ { ... } ] }
//
// Entity shape is parameterized by CLI flags. The scaffolded analyzer fixes
// these at generation time so its fixture command is a one-word invocation.
//
// Required:
//   --entity-key=<k>      top-level array key in the actual artifact
// Optional:
//   --id-field=<f>        default: "entity_id"
//   --decision-field=<f>  default: "decision"
//   --rule-field=<f>      default: "rule_fired"
//   --actual-path=<p>     default: "actual/analysis.json" (relative to fixture dir)
//   --hint=<msg>          text appended to "missing actual" error to tell the
//                         reviewer how to regenerate it

const { flags, positional } = parseArgs(argv);
if (positional.length !== 1 || !flags["entity-key"]) {
  stderr.write("usage: node compare-fixture.mjs <fixture-dir> --entity-key=<k> [--id-field=<f>] [--decision-field=<f>] [--rule-field=<f>] [--actual-path=<p>] [--hint=<msg>]\n");
  exit(2);
}

const dir = positional[0];
const entityKey     = flags["entity-key"];
const idField       = flags["id-field"]       ?? "entity_id";
const decisionField = flags["decision-field"] ?? "decision";
const ruleField     = flags["rule-field"]     ?? "rule_fired";
const actualRel     = flags["actual-path"]    ?? "actual/analysis.json";
const regenHint     = flags["hint"]           ?? "regenerate the actual artifact and copy it into place";

const expectedPath = join(dir, "expected.json");
const actualPath   = join(dir, actualRel);

if (!existsSync(expectedPath)) {
  stderr.write(`ENOENT: ${expectedPath}\n`);
  exit(2);
}

if (!existsSync(actualPath)) {
  stderr.write(`missing ${actualPath} — ${regenHint}\n`);
  exit(2);
}

const expectedDoc = JSON.parse(readFileSync(expectedPath, "utf8"));
const expected  = expectedDoc.expected  ?? [];
const forbidden = expectedDoc.forbidden ?? [];
const actualDoc = JSON.parse(readFileSync(actualPath, "utf8"));
const entities  = actualDoc[entityKey] ?? [];

const byId = new Map(entities.map(e => [e[idField], e]));

const failures = [];
for (const e of expected) {
  const a = byId.get(e[idField]);
  if (!a) {
    failures.push(`missing ${idField}: ${JSON.stringify(e)}`);
    continue;
  }
  if (a[decisionField] !== e[decisionField] || a[ruleField] !== e[ruleField]) {
    failures.push(
      `mismatch for ${idField}=${e[idField]}: ` +
      `expected ${decisionField}=${e[decisionField]} ${ruleField}=${e[ruleField]}, ` +
      `got ${decisionField}=${a[decisionField]} ${ruleField}=${a[ruleField]}`
    );
  }
}

for (const id of forbidden) {
  if (byId.has(id)) {
    failures.push(`forbidden ${idField} present in ${entityKey}: ${id} — candidate should have been dropped`);
  }
}

if (failures.length > 0) {
  for (const f of failures) stderr.write(f + "\n");
  stderr.write(`\nFIXTURE FAIL: ${failures.length} mismatch(es) in ${dir}\n`);
  exit(1);
}

stdout.write(`FIXTURE OK: ${expected.length} expected + ${forbidden.length} forbidden check(s) passed in ${dir}\n`);
exit(0);
