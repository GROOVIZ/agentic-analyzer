import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { argv, exit, stderr, stdout } from "node:process";
import { parseArgs } from "./_args.mjs";

// Fixture scaffolding helper for any agentic-analyzer instance.
//
// Creates a minimal fixture directory with:
//   <fixture-dir>/
//     README.md
//     target/.gitkeep
//     expected.json
//     .gitignore  (excludes actual/)
//
// The expected.json has a one-line `expected[]` and `forbidden[]` the author
// fills in. The comparator accepts supersets, so the author only needs to
// assert on the entries their rule produces.
//
// Usage:
//   node fixture-init.mjs --dir=<path> --id-field=<f> [--positive|--negative] [--force]
//
// The --positive / --negative switch controls whether expected[] is seeded
// with a single stub row (rule fires, produces a decision) or forbidden[]
// is seeded with a single stub id (rule must NOT fire — used for drop-rule
// coverage). Defaults to --positive.

const { flags } = parseArgs(argv);
const usage = "usage: node fixture-init.mjs --dir=<path> --id-field=<f> [--positive|--negative] [--force]\n";
for (const req of ["dir", "id-field"]) {
  if (!flags[req]) { stderr.write(usage); exit(2); }
}

const dir = flags["dir"];
const idField = flags["id-field"];
const mode = flags["negative"] ? "negative" : "positive";

if (existsSync(dir) && !flags.force) {
  stderr.write(`fixture already exists: ${dir}\nuse --force to overwrite (wipes the existing dir)\n`);
  exit(1);
}

mkdirSync(dir, { recursive: true });
mkdirSync(join(dir, "target"), { recursive: true });

writeFileSync(join(dir, "target", ".gitkeep"), "");

writeFileSync(join(dir, ".gitignore"), [
  "# `actual/` is populated by reviewers running the analyzer — never commit.",
  "actual/",
  ""
].join("\n"));

const expected = mode === "positive"
  ? {
      "$comment": "Replace the stub row with the real expectation. Remove this key when done.",
      "expected": [{
        [idField]: "TODO:stable-id-string",
        "decision": "TODO:one-of-your-decision-enum",
        "rule_fired": "TODO:the-rule-id-this-fixture-exercises"
      }]
    }
  : {
      "$comment": "Negative fixture — the listed id must NOT appear in the analyzer's output (e.g., it was dropped by a triage rule). Remove this key when done.",
      "forbidden": [
        "TODO:stable-id-string-that-should-not-appear"
      ]
    };

writeFileSync(join(dir, "expected.json"), JSON.stringify(expected, null, 2) + "\n", "utf8");

writeFileSync(join(dir, "README.md"), [
  `# Fixture: \`${dir}\``,
  "",
  `**Kind:** ${mode}`,
  "",
  "## Author checklist",
  "",
  "1. Populate `target/` with the minimum source files needed to produce",
  "   the candidate this fixture exercises (usually 1–3 files).",
  "2. Edit `expected.json` — replace the TODO values with the real",
  `   \`${idField}\`, decision, and rule label.`,
  "3. Delete the `$comment` field when the stubs are gone.",
  "4. Run the analyzer against `target/`, copy the resulting",
  "   `analysis.json` into `actual/`, and run the comparator:",
  "   ```",
  "   node <analyzer>/bin/compare-fixture.mjs <this-fixture-dir> \\",
  "     --entity-key=<k> \\",
  `     --id-field=${idField}`,
  "   ```",
  "5. The expected output is `FIXTURE OK`. If not, either the rule",
  "   needs work, or this fixture's target needs tightening.",
  ""
].join("\n"));

stdout.write(`initialized ${mode} fixture at ${dir}\n`);
stdout.write("next: populate target/, edit expected.json (remove the $comment key and the TODO values), and run the analyzer.\n");
exit(0);
