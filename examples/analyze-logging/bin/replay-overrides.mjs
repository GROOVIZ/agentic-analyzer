import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { argv, exit, stderr, stdout } from "node:process";
import { parseArgs } from "./_args.mjs";

// Override-replay engine for any agentic-analyzer instance.
//
// Consumes analysis.json and overrides.json (both v2). For every override
// whose `<id_field>` and `snippet_normalized_sha256` match a live entry,
// with stage == "final" and decision != null, replaces the entry's decision
// and sets `decision_source: "override"`. `rule_fired` is preserved so the
// original rule trace survives. Overrides that don't match (orphans) are
// reported but not removed — they survive for future runs.
//
// Output (stdout): JSON report
//   { "matched": N, "unmatched": [{ "id": "...", "reason": "..." }],
//     "schema_version_seen": "1.0.0" | "2.0.0" | "legacy-v1" }
//
// Exit codes:
//   0 — ran to completion (even if some overrides didn't match)
//   1 — analysis.json or overrides.json missing / unparseable / malformed
//   2 — invocation error (bad flags)
//
// The caller decides what to do with unmatched entries (typically: append
// each as a `degradations[]` entry in coverage.json with stage
// `"override-replay"`).

const { flags } = parseArgs(argv);
const usage = "usage: node replay-overrides.mjs --analysis=<path> --overrides=<path> --entity-key=<k> --id-field=<f> [--write]\n";

for (const req of ["analysis", "overrides", "entity-key", "id-field"]) {
  if (!flags[req]) { stderr.write(usage); exit(2); }
}

const analysisPath  = flags["analysis"];
const overridesPath = flags["overrides"];
const entityKey     = flags["entity-key"];
const idField       = flags["id-field"];
const writeBack     = Boolean(flags["write"]);

function readJson(path, label) {
  if (!existsSync(path)) { stderr.write(`${label} not found: ${path}\n`); exit(1); }
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (e) { stderr.write(`${label} parse error: ${e.message}\n`); exit(1); }
}

const analysis  = readJson(analysisPath,  "analysis");
const overrides = readJson(overridesPath, "overrides");

if (!Array.isArray(analysis[entityKey])) {
  stderr.write(`analysis missing array at key "${entityKey}"\n`); exit(1);
}

// Detect schema version. v2 has schema_version == "2.0.0". v1 is missing that
// property. We do not migrate here — migration is a separate CLI step
// (`migrate-overrides-v1-v2.mjs`) so the caller can decide whether to back up
// the file first.
const isV2 = overrides?.schema_version === "2.0.0";
if (!isV2) {
  stdout.write(JSON.stringify({
    matched: 0,
    unmatched: [],
    schema_version_seen: overrides?.schema_version ?? "legacy-v1"
  }) + "\n");
  stderr.write("overrides schema_version != 2.0.0; nothing applied. Run migrate-overrides-v1-v2.mjs first if this is a legacy v1 file.\n");
  exit(0);
}

if (!Array.isArray(overrides.overrides)) {
  stderr.write(`overrides missing "overrides" array\n`); exit(1);
}

const byIdAndHash = new Map();
for (const e of analysis[entityKey]) {
  if (typeof e[idField] !== "string") continue;
  if (typeof e?.source?.snippet_normalized_sha256 !== "string") continue;
  byIdAndHash.set(`${e[idField]}|${e.source.snippet_normalized_sha256}`, e);
}

let matched = 0;
const unmatched = [];
for (const o of overrides.overrides) {
  const id   = o[idField];
  const hash = o.snippet_normalized_sha256;
  if (typeof id !== "string" || typeof hash !== "string") {
    unmatched.push({ id: id ?? null, reason: "override missing id or hash" });
    continue;
  }
  const key = `${id}|${hash}`;
  const target = byIdAndHash.get(key);
  if (!target) {
    unmatched.push({ id, reason: `no live entry with matching ${idField} + snippet_normalized_sha256` });
    continue;
  }
  if (o.stage !== "final" || o.decision === null || o.decision === undefined) {
    // tentative or flag-only overrides do not mutate analysis.json;
    // they still live in the overrides file so the review app can show them.
    continue;
  }
  target.decision = o.decision;
  target.decision_source = "override";
  // rule_fired is preserved untouched.
  // confidence reflects evidence-quality for the *decision now in force*.
  // Rule-evidence confidence no longer applies once a human has overridden,
  // so we default to "low" unless the reviewer supplied an explicit level.
  target.confidence = typeof o.confidence === "string" ? o.confidence : "low";
  matched++;
}

if (writeBack) writeFileSync(analysisPath, JSON.stringify(analysis, null, 2) + "\n", "utf8");

stdout.write(JSON.stringify({
  matched,
  unmatched,
  schema_version_seen: "2.0.0"
}) + "\n");
exit(0);
