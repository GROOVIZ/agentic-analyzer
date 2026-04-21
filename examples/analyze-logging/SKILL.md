---
name: analyze-logging
description: Discover, classify, and inventory every Log call-site in a target repository. Produces a schema-validated JSON inventory labeling each entry against a versioned ruleset, assuming target `pii-regulated`. Only invoke when the user explicitly requests logging analysis, inventory, or review.
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash(realpath *)
  - Bash(node *)
  - Bash(git *)
  - Bash(mkdir *)
  - Bash(test *)
  - Bash(cat *)
  - Bash(printf *)
  - Bash(ls *)
  - Bash(rm *)
  - mcp__plugin_serena_serena__*
  - mcp__plugin_context7_context7__*
---

You are the logging-analysis orchestrator for the `analyze-logging`
skill.

The deployment target is fixed: **pii-regulated**. Record
`target: "pii-regulated"` in `analysis.json`.

## Step 1 — Preflight

1. Resolve the argument `$1` to an absolute path. If `$1` is empty, use the
   project root. Fail with a clear error if the path does not exist or is not
   readable.
2. Check Serena MCP availability. If Serena tools are not present, **stop immediately** with: *"Serena MCP is required. Install and enable the Serena plugin before running /analyze-logging."*
3. If Serena is available, activate it on the target repository:
   `mcp__plugin_serena_serena__activate_project` with the absolute path. If
   activation fails, abort with Serena's error.
4. Check Context7 MCP availability. If Context7 tools are not present, **stop immediately** with: *"Context7 MCP is required. Install and enable the Context7 plugin before running /analyze-logging."*
5. Generate a run id: ISO-8601 UTC timestamp, colons replaced with dashes.
6. Capture the previous run id if any:
   `test -f logging-analysis/output/latest.txt && cat logging-analysis/output/latest.txt || printf ""`.
7. Create the output directory:
   `mkdir -p logging-analysis/output/runs/<run-id>`.

## Step 2 — Phase A: Framework survey

Follow `prompts/discovery.md` §Phase A.

Write the partial candidates document to
`logging-analysis/output/runs/<run-id>/_phaseA.json`.

Validate:

```
node $SKILL_DIR/bin/validate.mjs $SKILL_DIR/schema/candidates.schema.json logging-analysis/output/runs/<run-id>/_phaseA.json
```

On non-zero exit, abort and surface stderr.

## Step 3 — Phase B: Symbolic enumeration

Follow `prompts/discovery.md` §Phase B. For every surface produced in Phase A,
use Serena's `find_symbol` and `find_referencing_symbols`.

Append new candidates into
`logging-analysis/output/runs/<run-id>/_phaseB.json`.

## Step 4 — Phase C: Ad-hoc + config correlation (optional)

If your domain has ad-hoc or config-driven candidates, follow
`prompts/discovery.md` §Phase C. Otherwise skip.

Write the combined candidates file to
`logging-analysis/output/runs/<run-id>/candidates.json` and
validate:

```
node $SKILL_DIR/bin/validate.mjs $SKILL_DIR/schema/candidates.schema.json logging-analysis/output/runs/<run-id>/candidates.json
```

## Step 5 — Phase D: Classification

Follow `prompts/classification.md`. Apply rules from `rules.md` in the
evaluation order documented there.

Write `logging-analysis/output/runs/<run-id>/analysis.json`:

- `schema_version: "1.0.0"`
- `ruleset_version: "<date from rules.md>"`
- `run_id: "<run-id>"`
- `target: "pii-regulated"`
- `repository.path` — absolute path from Step 1.
- `repository.commit` — `git -C <path> rev-parse HEAD` or `"untracked"`.
- `coverage_ref: "./coverage.json"`
- `entries[]` — one entry per candidate.

Every entry you emit in Phase D has `decision_source: "rule"`. The Step 7
override replay may rewrite that to `"override"`; Phase D itself never emits
`"override"`. The entry's `confidence` reflects the rule's evidence quality
(see `rules.md` confidence table); the override replay may *lower* confidence
when a human overrides the decision, but Phase D does not.

Validate:

```
node $SKILL_DIR/bin/validate.mjs $SKILL_DIR/schema/analysis.schema.json logging-analysis/output/runs/<run-id>/analysis.json
```

## Step 6 — Coverage

Write `logging-analysis/output/runs/<run-id>/coverage.json`, then
validate with `$SKILL_DIR/schema/coverage.schema.json`.

Always include `serena_available`, `context7_available`,
`frameworks_surveyed[]`, `files_visited`, `symbols_resolved`,
`unresolved_symbols[]`, and `degradations[]`.

## Step 7 — Override carry-forward

Overrides live at `logging-analysis/overrides.json`
(repo-level, shared across runs). Runs only **read** this file.

1. If the file exists:
   - `node $SKILL_DIR/bin/validate.mjs $SKILL_DIR/schema/overrides.schema.json logging-analysis/overrides.json`
   - If validation fails: add a `degradations[]` entry (stage
     `"override-replay"`, reason `"overrides.json failed schema"`) and
     skip replay. Do NOT abort.
2. Otherwise, if a legacy v1 file exists (user site's choice), migrate:
   `node $SKILL_DIR/bin/migrate-overrides-v1-v2.mjs --input=<path> --id-field=call_site_id`.
3. Apply overrides:
   ```
   node $SKILL_DIR/bin/replay-overrides.mjs \
     --analysis=logging-analysis/output/runs/<run-id>/analysis.json \
     --overrides=logging-analysis/overrides.json \
     --entity-key=entries \
     --id-field=call_site_id \
     --write
   ```
4. Parse the JSON report on stdout. For each `unmatched[]` entry, append a
   `degradations[]` record of stage `"override-replay"` with the reason from
   the CLI.

Re-validate `analysis.json` and `coverage.json` after the replay.

## Step 8 — Update latest.txt

```
printf '%s' '<run-id>' > logging-analysis/output/latest.txt
rm -f logging-analysis/output/runs/<run-id>/_phaseA.json \
      logging-analysis/output/runs/<run-id>/_phaseB.json
```

## Step 9 — Summary

Print to the session:

```
/analyze-logging complete

Run id:      <run-id>
Repository:  <abs-path> @ <commit-or-untracked>
Entries:     <N>
<per-decision breakdown>

Rules fired (count): <tally of rule labels>
Overrides carried forward: <n>
Coverage degradations: <n>

Output:
  logging-analysis/output/runs/<run-id>/analysis.json
  logging-analysis/output/runs/<run-id>/coverage.json
  logging-analysis/overrides.json        (repo-level, shared across runs)
```

## Hard rules

- Decisions live in the closed set `["allow", "redact", "remove", null]`.
- Never skip validation. Every phase validates before the next begins.
- Never write redacted-key values in plaintext.
- Hard-fail on schema violations. Warnings go to `coverage.degradations[]`.
- Identity = `(call_site_id, source.snippet_normalized_sha256)`. That pair
  is the contract between the agent and the override engine; any change to
  either invalidates replay.

## Notes for the author

`$SKILL_DIR` in the commands above refers to the directory of this
`SKILL.md`. In a Claude Code session launched with `--add-dir` over the
target repo, resolve it with `realpath "$(dirname "$0")"` or hard-code the
path (`.claude/skills/analyze-logging`) depending on your install.

Phase C is optional — if your domain has no ad-hoc or config-driven
candidates (e.g., all entries are framework-annotation), delete Step 4.
