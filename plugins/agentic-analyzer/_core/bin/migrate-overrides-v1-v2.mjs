import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { argv, exit, stderr, stdout } from "node:process";
import { parseArgs } from "./_args.mjs";

// Migrate a legacy v1 overrides file into v2. Writes the v2 result back to
// --output (or to --input if --output is omitted). Creates a one-time backup
// at <input>.v1.bak.json if not already present.
//
// v1 entry shape:
//   { <id_field>, snippet_normalized_sha256, decision, reviewer, note?, created_at }
//
// v2 entry shape:
//   { <id_field>, snippet_normalized_sha256, flagged: false,
//     decision, stage: "final", reviewer, feedback: [], updated_at }
//
// The v1 `note` field is dropped — v2 replaces per-entry notes with a
// feedback[] list seeded by the review app, not carried forward.

const { flags } = parseArgs(argv);
const usage = "usage: node migrate-overrides-v1-v2.mjs --input=<path> --id-field=<f> [--output=<path>]\n";

for (const req of ["input", "id-field"]) {
  if (!flags[req]) { stderr.write(usage); exit(2); }
}

const input   = flags["input"];
const output  = flags["output"] ?? flags["input"];
const idField = flags["id-field"];

if (!existsSync(input)) { stderr.write(`input not found: ${input}\n`); exit(1); }

let doc;
try { doc = JSON.parse(readFileSync(input, "utf8")); }
catch (e) { stderr.write(`parse error: ${e.message}\n`); exit(1); }

if (doc?.schema_version === "2.0.0") {
  stderr.write("already v2; nothing to do\n");
  exit(0);
}

if (!Array.isArray(doc?.overrides)) {
  stderr.write("expected v1 shape: { overrides: [...] }\n"); exit(1);
}

const migrated = doc.overrides.map(o => {
  if (typeof o[idField] !== "string") {
    throw new Error(`override missing id field "${idField}": ${JSON.stringify(o)}`);
  }
  return {
    [idField]: o[idField],
    snippet_normalized_sha256: o.snippet_normalized_sha256,
    flagged: false,
    decision: o.decision,
    stage: "final",
    reviewer: o.reviewer,
    feedback: [],
    updated_at: o.created_at
  };
});

const backupPath = `${input}.v1.bak.json`;
if (!existsSync(backupPath) && input === output) {
  copyFileSync(input, backupPath);
}

const v2 = { schema_version: "2.0.0", overrides: migrated };
writeFileSync(output, JSON.stringify(v2, null, 2) + "\n", "utf8");
stdout.write(`migrated ${migrated.length} entries from v1 → v2; backup at ${backupPath}\n`);
exit(0);
