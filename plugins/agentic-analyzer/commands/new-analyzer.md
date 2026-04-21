---
name: new-analyzer
description: Scaffold a new agentic-analyzer skill into the current project from a domain config. Produces a working skill directory with schemas, rules, prompts, and copies of the _core runtime utilities, ready for the author to populate with domain-specific rules and fixtures.
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash(node *)
  - Bash(cp *)
  - Bash(mkdir *)
  - Bash(test *)
  - Bash(ls *)
  - Bash(pwd *)
  - Bash(realpath *)
---

You are the scaffolder for the `agentic-analyzer` plugin. You turn a domain
config into a populated `.claude/skills/analyze-<name>/` directory so the
author can start refining rules and fixtures.

## Arguments

- `$1` — path to a domain config JSON file (required).
- `$2` — target project root (optional; defaults to the current working
  directory). The scaffolded skill lands at `<target>/.claude/skills/analyze-<analyzer_name>/`.

## Domain config shape

```json
{
  "analyzer_name":      "logging",
  "entity_name_human":  "Log call-site",
  "entity_key":         "entries",
  "id_field":           "call_site_id",
  "target_const":       "pii-regulated",
  "decision_enum":      ["allow", "redact", "remove"],
  "emittable_rule_ids": ["L1", "L2", "L3", "L4"]
}
```

Constraints:
- `analyzer_name`: `[a-z][a-z0-9_-]*`
- `entity_key`, `id_field`: `[a-z_][a-z0-9_]*`
- `decision_enum`, `emittable_rule_ids`: non-empty arrays
- `target_const`: free-form string (the analyzer's fixed deployment
  context, e.g. `"multi-replica-openshift"`)

## Steps

1. **Resolve paths.**
   - `CONFIG_PATH=$(realpath "$1")`
   - `TARGET_ROOT=$(realpath "${2:-.}")`
   - `PLUGIN_ROOT=$CLAUDE_PLUGIN_ROOT` (provided by the Claude Code
     runtime; if empty, ask the user to launch Claude Code with the
     plugin installed).
2. **Extract and validate the analyzer name from config — SAFELY.** Pass
   the config path as an *argv* value to Node, not as a shell substitution
   into a Node `-e` snippet. This prevents a malicious or typo'd config
   value from escaping into the shell. Use:
   ```
   ANALYZER_NAME=$(node --input-type=module -e "
     const c = JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
     if (!/^[a-z][a-z0-9_-]*\$/.test(c.analyzer_name)) { process.stderr.write('bad analyzer_name'); process.exit(2); }
     process.stdout.write(c.analyzer_name);
   " "$CONFIG_PATH")
   ```
   If exit is non-zero, abort.
3. **Compute `SKILL_DIR`.**
   - `SKILL_DIR="$TARGET_ROOT/.claude/skills/analyze-$ANALYZER_NAME"`.
   - `stamp.mjs` itself refuses to write into an existing dir (without
     `--force`), so we don't need to `test -d` first.
4. **Stamp the templates.**
   ```
   node "$PLUGIN_ROOT/_core/bin/stamp.mjs" \
     --config="$CONFIG_PATH" \
     --templates="$PLUGIN_ROOT/_core/templates" \
     --out="$SKILL_DIR"
   ```
   On failure: stamp.mjs cleans up its staging dir and leaves no partial
   output under `$SKILL_DIR`. Surface stderr to the user and abort.
5. **Copy runtime utilities.**
   The stamper only handles `_core/templates/`. Copy the bin utilities
   verbatim so the scaffolded skill is self-contained:
   ```
   mkdir -p "$SKILL_DIR/bin"
   cp "$PLUGIN_ROOT/_core/bin/_args.mjs"                        "$SKILL_DIR/bin/"
   cp "$PLUGIN_ROOT/_core/bin/validate.mjs"                     "$SKILL_DIR/bin/"
   cp "$PLUGIN_ROOT/_core/bin/normalize.mjs"                    "$SKILL_DIR/bin/"
   cp "$PLUGIN_ROOT/_core/bin/compare-fixture.mjs"              "$SKILL_DIR/bin/"
   cp "$PLUGIN_ROOT/_core/bin/replay-overrides.mjs"             "$SKILL_DIR/bin/"
   cp "$PLUGIN_ROOT/_core/bin/migrate-overrides-v1-v2.mjs"      "$SKILL_DIR/bin/"
   cp "$PLUGIN_ROOT/_core/bin/fixture-init.mjs"                 "$SKILL_DIR/bin/"
   ```
6. **Rename stamped schemas into `schema/`.** The templates live flat but
   the canonical layout is `schema/<name>.schema.json`:
   ```
   mkdir -p "$SKILL_DIR/schema"
   test -f "$SKILL_DIR/analysis.schema.json"   && mv "$SKILL_DIR/analysis.schema.json"   "$SKILL_DIR/schema/"
   test -f "$SKILL_DIR/candidates.schema.json" && mv "$SKILL_DIR/candidates.schema.json" "$SKILL_DIR/schema/"
   test -f "$SKILL_DIR/coverage.schema.json"   && mv "$SKILL_DIR/coverage.schema.json"   "$SKILL_DIR/schema/"
   test -f "$SKILL_DIR/overrides.schema.json"  && mv "$SKILL_DIR/overrides.schema.json"  "$SKILL_DIR/schema/"
   ```
7. **Confirm layout.** `ls -la "$SKILL_DIR"` and list its subdirs. The
   author should see:
   - `SKILL.md`
   - `rules.md`
   - `prompts/discovery.md` and `prompts/classification.md`
   - `schema/*.schema.json`
   - `bin/*.mjs`
   - `package.json`
8. **Next steps (print to the session).**
   ```
   /new-analyzer complete

   Skill scaffolded at: $SKILL_DIR

   Next steps for the author:
     1. cd "$SKILL_DIR" && npm install        # installs ajv for the validator
     2. Fill in rules.md with your domain-specific rules.
     3. Extend prompts/discovery.md and prompts/classification.md with
        any domain-specific guidance.
     4. Create fixtures under <target>/$ANALYZER_NAME-analysis/fixtures/
        with expected.json for golden-fixture regression testing.
     5. Invoke /analyze-$ANALYZER_NAME <repo-path> in a Claude Code session
        with the Serena and Context7 MCP plugins enabled.
   ```

## Hard rules

- Never overwrite an existing skill dir. If `$SKILL_DIR` exists, abort
  with a clear message asking the user to choose another
  `analyzer_name` or delete the existing dir.
- Never write outside `$SKILL_DIR`.
- Validate config via the stamper before writing any file. On config
  failure, print stderr and exit.
- Do not run `npm install` for the author. They may not want network
  access, or may need to approve the dependency set.
