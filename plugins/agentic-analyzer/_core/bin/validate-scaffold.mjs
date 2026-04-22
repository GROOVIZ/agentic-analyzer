import { readFileSync, readdirSync, lstatSync, existsSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { argv, exit, stderr, stdout } from "node:process";
import { parseArgs } from "./_args.mjs";

// Post-stamp quality gate for a scaffolded analyzer skill.
//
// Verifies that a directory produced by /new-analyzer (stamp + rules.md
// write + bin/ copy + fixture scaffolding) is structurally sound before
// the author trusts it.
//
// Checks:
//   1. Every required file is present.
//   2. No stamped file retains an unresolved `{{PLACEHOLDER}}` token.
//   3. SKILL.md has valid YAML frontmatter with `name: analyze-<slug>`
//      and a non-empty `description`.
//   4. (Opt-in, via --rule-ids) each rule has a fixture skeleton at
//      fixtures/<rule-id>/expected.json.
//
// Usage:
//   node validate-scaffold.mjs <skill-dir> [--rule-ids=<comma-separated>]
//
// Exits 0 if the scaffold looks complete; non-zero and writes a bullet
// list of every issue found to stderr otherwise. All issues are reported
// in a single run so the author can fix them in one pass.

const { flags, positional } = parseArgs(argv);
if (positional.length !== 1) {
  stderr.write("usage: node validate-scaffold.mjs <skill-dir> [--rule-ids=<comma-separated>]\n");
  exit(2);
}

const ruleIds = (() => {
  if (!("rule-ids" in flags)) return null;
  const raw = String(flags["rule-ids"] ?? "");
  const parsed = raw.split(",").map(s => s.trim()).filter(s => s.length > 0);
  if (parsed.length === 0) {
    stderr.write("--rule-ids must be a non-empty comma-separated list\n");
    exit(2);
  }
  return parsed;
})();

const skillDir = resolve(positional[0]);

if (!existsSync(skillDir)) {
  stderr.write(`skill directory not found: ${skillDir}\n`);
  exit(2);
}

const REQUIRED_FILES = [
  "SKILL.md",
  "rules.md",
  "package.json",
  "prompts/discovery.md",
  "prompts/classification.md",
  "schema/analysis.schema.json",
  "schema/candidates.schema.json",
  "schema/coverage.schema.json",
  "schema/overrides.schema.json",
  "bin/_args.mjs",
  "bin/validate.mjs",
  "bin/normalize.mjs",
  "bin/compare-fixture.mjs",
  "bin/replay-overrides.mjs",
  "bin/migrate-overrides-v1-v2.mjs",
  "bin/fixture-init.mjs"
];

const PLACEHOLDER_RE = /\{\{([A-Z0-9_]+)\}\}/g;

const issues = [];

// 1. Required files.
for (const rel of REQUIRED_FILES) {
  if (!existsSync(join(skillDir, rel))) {
    issues.push(`missing: ${rel}`);
  }
}

// 2. Unresolved placeholders in any file present under the skill dir.
//    A stamped file that still contains `{{FOO}}` means stamp.mjs saw an
//    unknown token or a downstream edit reintroduced one — either way, the
//    skill is broken.
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = lstatSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (st.isFile()) out.push(p);
  }
  return out;
}

for (const abs of walk(skillDir)) {
  const rel = relative(skillDir, abs).split(sep).join("/");
  let text;
  try { text = readFileSync(abs, "utf8"); }
  catch { continue; }
  PLACEHOLDER_RE.lastIndex = 0;
  const seen = new Set();
  let m;
  while ((m = PLACEHOLDER_RE.exec(text)) !== null) seen.add(m[1]);
  for (const token of seen) {
    issues.push(`unresolved placeholder {{${token}}} in ${rel}`);
  }
}

// 3. SKILL.md frontmatter.
const skillPath = join(skillDir, "SKILL.md");
if (existsSync(skillPath)) {
  const text = readFileSync(skillPath, "utf8");
  const fm = parseFrontmatter(text);
  if (!fm.ok) {
    issues.push(`SKILL.md: ${fm.reason}`);
  } else {
    const { name, description } = fm.fields;
    if (!name) {
      issues.push("SKILL.md: frontmatter missing `name` field");
    } else if (!/^analyze-[a-z0-9][a-z0-9_-]*$/.test(name)) {
      issues.push(`SKILL.md: frontmatter \`name\` must match analyze-<slug> (got "${name}")`);
    }
    if (description === undefined) {
      issues.push("SKILL.md: frontmatter missing `description` field");
    } else if (description.trim() === "") {
      issues.push("SKILL.md: frontmatter `description` must be non-empty");
    }
  }
}

// 4. Per-rule fixture coverage (opt-in).
if (ruleIds) {
  for (const id of ruleIds) {
    const fixturePath = join(skillDir, "fixtures", id, "expected.json");
    if (!existsSync(fixturePath)) {
      issues.push(`missing fixture for ${id}: fixtures/${id}/expected.json`);
    }
  }
}

// 5. rules.md ID-column cross-check (opt-in, paired with --rule-ids).
//    The rule-author template produces a markdown table with
//    `| ID | Rule | Decision |` — we parse the first such table and
//    ensure the CLI set matches the table set exactly. If no parseable
//    table is found, skip silently (the author may be mid-iteration).
if (ruleIds) {
  const rulesPath = join(skillDir, "rules.md");
  if (existsSync(rulesPath)) {
    const tableIds = parseRulesTable(readFileSync(rulesPath, "utf8"));
    if (tableIds !== null) {
      const cliSet = new Set(ruleIds);
      const tblSet = new Set(tableIds);
      for (const id of cliSet) {
        if (!tblSet.has(id)) {
          issues.push(`rule-id ${id} in --rule-ids but not in rules.md table`);
        }
      }
      for (const id of tblSet) {
        if (!cliSet.has(id)) {
          issues.push(`rule-id ${id} in rules.md table but not in --rule-ids`);
        }
      }
    }
  }
}

if (issues.length === 0) {
  stdout.write(`scaffold ok: ${skillDir}\n`);
  exit(0);
}

stderr.write(`scaffold validation failed (${issues.length} issue${issues.length === 1 ? "" : "s"}):\n`);
for (const i of issues) stderr.write(`  - ${i}\n`);
exit(1);

function parseRulesTable(text) {
  // Find the first markdown table whose first column header is (case-
  // insensitively) "ID". Return the list of first-column values,
  // trimmed. Return null if no qualifying table is found.
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const header = lines[i];
    if (!header.startsWith("|")) continue;
    const cells = header.split("|").map(s => s.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
    if (cells.length === 0 || cells[0].toLowerCase() !== "id") continue;
    // Expect a separator row on the next line.
    const sep = lines[i + 1] ?? "";
    if (!/^\s*\|[\s:|-]+\|\s*$/.test(sep)) continue;
    // Collect IDs from subsequent pipe rows until a blank or non-pipe line.
    const ids = [];
    for (let j = i + 2; j < lines.length; j++) {
      const row = lines[j];
      if (!row.trim().startsWith("|")) break;
      const rowCells = row.split("|").map(s => s.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
      if (rowCells.length === 0) break;
      const id = rowCells[0];
      if (id.length > 0) ids.push(id);
    }
    return ids.length > 0 ? ids : null;
  }
  return null;
}

function parseFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") {
    return { ok: false, reason: "missing YAML frontmatter (file must start with `---`)" };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") { end = i; break; }
  }
  if (end === -1) {
    return { ok: false, reason: "unterminated YAML frontmatter (no closing `---`)" };
  }
  const fields = {};
  // Match top-level `key: value` lines; ignore continuation / nested list items.
  const kv = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/;
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (line.startsWith(" ") || line.startsWith("\t") || line.startsWith("-")) continue;
    const m = kv.exec(line);
    if (m) fields[m[1]] = m[2];
  }
  return { ok: true, fields };
}
