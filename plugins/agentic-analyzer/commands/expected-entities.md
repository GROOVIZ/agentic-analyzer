---
name: expected-entities
description: Maintain the dev-team "expected entities" oracle for an analyzer. Accepts a file path or a quoted free-form string (chat comment, pasted list, table). Normalizes the input via the entity-list-ingestor subagent, merges into <analyzer>-analysis/expected-entities.json, and optionally runs compare-entities against the latest analysis.json.
argument-hint: "<input-or-path> [--target=<repo>] [--analyzer=<name>] [--replace] [--run-compare]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Task
  - Bash(node *)
  - Bash(ls *)
  - Bash(pwd *)
---

You maintain the canonical `expected-entities.json` file for a specific
analyzer at the target-repo level. The file lives at
`<target>/<analyzer_name>-analysis/expected-entities.json`, mirroring the
`overrides.json` convention.

The user's input can be anything — a file path to a plain-text list, a
pasted CSV row, a free-form sentence ("I noticed azertyentity is
missing"). You delegate normalization to the `entity-list-ingestor`
subagent; you handle file I/O, merging, and validation.

## Arguments

The first argument `$1` is either:

- an absolute or repo-relative **file path** (e.g. `./team-list.txt`), or
- a **quoted free-form string** (e.g. `"I notice azertyentity is missing"`).

Additional flags parsed from the remaining arguments:

- `--target=<path>` — target repo root. Defaults to cwd.
- `--analyzer=<name>` — which analyzer's list to update. If omitted and
  exactly one `.claude/skills/analyze-*` exists under `--target`, use
  that one. Otherwise abort and list the candidates.
- `--replace` — overwrite the canonical instead of merging.
- `--run-compare` — after merging, run `compare-entities.mjs` against
  the latest `analysis.json` (reading the run id from
  `<analyzer_name>-analysis/output/latest.txt`).

## Steps

### Step 1 — Preflight

Resolve:

```
TARGET_ROOT=$(node -e "process.stdout.write(require('path').resolve(process.argv[1]))" "${target:-.}")
PLUGIN_ROOT="$CLAUDE_PLUGIN_ROOT"
```

Locate the analyzer:

- If `--analyzer` was given, use it. Fail if
  `$TARGET_ROOT/.claude/skills/analyze-$ANALYZER_NAME/SKILL.md` doesn't
  exist.
- Otherwise `Glob` for `.claude/skills/analyze-*` under `$TARGET_ROOT`.
  Exactly one match → use it. Zero or multiple matches → abort with
  the list and ask the user to pass `--analyzer=<name>`.

Read the analyzer's `schema/analysis.schema.json` and extract the
`decision_enum`. The decision values live at the entry schema's
`properties.decision.enum` (or the entry schema's `$ref` target when
the schema is factored). If you can't locate it reliably, set
`decision_enum = []` and note the fallback in the final summary.

Read the analyzer's `SKILL.md` frontmatter + body to extract
`id_field` (referenced in the Step 5 hard-rules line:
`Identity = ({{ID_FIELD}}, snippet_normalized_sha256)`) and
`entity_key` (referenced in the Phase D output shape as the top-level
array key). These also appear as stamped values in
`schema/analysis.schema.json` — cross-check there.

### Step 2 — Classify the input

Decide whether `$1` is a path or a free-form string:

- If `$1` exists as a readable file on disk, treat it as a file
  path. `Read` the file's contents.
- Otherwise treat `$1` as the raw text itself.

Either way, the result is `raw_input: "<text>"`.

### Step 3 — Dispatch the ingestor

Use the `Task` tool with `subagent_type: entity-list-ingestor`. Prompt:

```
MODE: dispatch
You were invoked by /expected-entities. Return ONLY the JSON envelope
specified in your agent definition.

INPUTS:
- raw_input:      <the text from Step 2, verbatim>
- source_hint:    "<path-or-comment-tag>"
- analyzer_name:  "<from Step 1>"
- decision_enum:  <from Step 1, as JSON array, or [] if unavailable>
```

`source_hint` is:
- `"file:<relpath>"` when the input came from a file.
- `"user-comment:<today YYYY-MM-DD>"` when the input was a free-form
  string.

Parse the envelope. If parsing fails, or `entities[]` is malformed,
abort with the raw output and ask the user to re-phrase.

Show the user the parsed `entities[]` plus any `uncertainties[]` as
a block. Ask: "Confirm these entities are correct; reply with
corrections or `ok`." Apply corrections by editing the in-memory
array; do NOT re-dispatch the subagent for small edits.

### Step 4 — Merge or replace the canonical

Canonical path:
`$TARGET_ROOT/$ANALYZER_NAME-analysis/expected-entities.json`

Read the existing canonical if present:

- File does not exist → treat existing as `{ schema_version: "1.0.0", entities: [] }`.
- File exists and is valid against
  `$PLUGIN_ROOT/_core/schema/expected-entities.schema.json` → load
  its `entities[]`.
- File exists but fails schema validation → abort; the user must
  fix or delete the corrupt file before merging new data.

If `--replace`:
- `merged.entities = ingested.entities`.

Otherwise:
- `merged.entities = existing.entities` +, for each ingested entity,
  if no existing entry has the same `name`, append it. When an
  existing entry has the same name, keep the existing one but
  append a note that the new source also reported it (do this by
  appending to the existing `note` field, not by duplicating the
  row).

Write `merged` back to the canonical path. Use the `Write` tool; the
file is small. Validate the write by running:

```
node "$PLUGIN_ROOT/_core/bin/validate.mjs" \
  "$PLUGIN_ROOT/_core/schema/expected-entities.schema.json" \
  "$TARGET_ROOT/$ANALYZER_NAME-analysis/expected-entities.json"
```

Abort on non-zero exit.

### Step 5 — Optional compare run

If `--run-compare` was passed:

1. Read `$TARGET_ROOT/$ANALYZER_NAME-analysis/output/latest.txt` to get
   the latest run id. If the file doesn't exist, skip Step 5 with a
   note: "no analysis run found; run /analyze-$ANALYZER_NAME first."
2. Run:
   ```
   node "$PLUGIN_ROOT/_core/bin/compare-entities.mjs" \
     "$TARGET_ROOT/$ANALYZER_NAME-analysis/expected-entities.json" \
     "$TARGET_ROOT/$ANALYZER_NAME-analysis/output/runs/<run-id>/analysis.json" \
     --entity-key=<from Step 1> \
     --id-field=<from Step 1>
   ```
3. Surface stdout to the user verbatim. The comparator's exit code
   is informational — do NOT abort `/expected-entities` on gaps;
   gaps are the whole point.

### Step 6 — Summary

Print:

```
/expected-entities complete

Analyzer:          $ANALYZER_NAME
Canonical:         $TARGET_ROOT/$ANALYZER_NAME-analysis/expected-entities.json
Entities added:    <N>    (<dedup-count> already present)
Entities total:    <M>

<if --run-compare was passed>
compare-entities report:
  matched:               ...
  missed:                ...
  ambiguous:             ...
  decision-mismatched:   ...
```

## Hard rules

- Never write to `<skill-dir>`; this command only touches the
  target-repo-level `<analyzer_name>-analysis/` directory.
- Never dispatch the ingestor for free-form edits the user makes
  during confirmation (Step 3). Edit the in-memory array directly.
- Never overwrite a malformed canonical file silently; ask the user
  to resolve it first.
- Never invent a decision value; only carry through what the
  ingestor returned (which, per its own rules, is only what the
  user literally said).
