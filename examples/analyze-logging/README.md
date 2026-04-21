# Example scaffolded analyzer — `analyze-logging`

This directory is the **output** of running the `agentic-analyzer`
scaffolder on `../logging-config.json`. It exists in the repo as a
worked example so readers can see what `/new-analyzer` produces before
they run it themselves.

**Status:** skeleton only. `rules.md`, `prompts/discovery.md`, and
`prompts/classification.md` contain the generic placeholders the
template ships. A real `analyze-logging` would fill these in with
domain-specific guidance (what a "PII category" is, which log libraries
to probe, what a `redact` decision looks like in practice).

## How it was produced

From the repo root:

```
node plugins/agentic-analyzer/_core/bin/stamp.mjs \
  --config=examples/logging-config.json \
  --templates=plugins/agentic-analyzer/_core/templates \
  --out=examples/analyze-logging

# Copy the verbatim bin/ utilities:
cp plugins/agentic-analyzer/_core/bin/{_args,validate,normalize,compare-fixture,replay-overrides,migrate-overrides-v1-v2,fixture-init}.mjs \
   examples/analyze-logging/bin/

# Move schemas into the canonical schema/ subdir:
mkdir -p examples/analyze-logging/schema
mv examples/analyze-logging/*.schema.json examples/analyze-logging/schema/
```

The `/agentic-analyzer:new-analyzer` command orchestrates the same
steps.

## What's in here

| Path | Purpose |
|---|---|
| `SKILL.md` | The skill a Claude Code session invokes as `/analyze-logging`. Refers to `$SKILL_DIR/bin/...` for the runtime utilities. |
| `rules.md` | Skeleton rule table. Author fills in L1..L5 with concrete triggers. |
| `prompts/discovery.md` | Phase A/B/C prompt. Author fills in domain-specific library list and identity convention. |
| `prompts/classification.md` | Phase D prompt. Mostly domain-agnostic. |
| `schema/analysis.schema.json` | Stamped from `analysis.schema.json.tmpl`. `target` const is `"pii-regulated"`. Entity key is `entries`, id field is `call_site_id`. |
| `schema/candidates.schema.json` | Stamped intermediate-output schema. |
| `schema/coverage.schema.json` | Stamped coverage-report schema (mostly domain-agnostic). |
| `schema/overrides.schema.json` | Stamped override file schema with `call_site_id` as the identity key. |
| `bin/*.mjs` | Verbatim copies of the `_core` runtime utilities. |
| `package.json` | The scaffolded skill's own ajv dependency. `npm install` to make the validator runnable. |

## What a real author would do next

1. `cd examples/analyze-logging && npm install`.
2. Populate `rules.md` with concrete rules (e.g., "L1: message contains a
   PII regex known to logback masking config" → `redact`).
3. Populate `prompts/discovery.md` with the logging libraries to probe
   (SLF4J, Log4j, java.util.logging, `console.log` in JS, ...).
4. Author fixtures under `../logging-analysis/fixtures/<name>/` with
   minimal target trees and `expected.json`.
5. Invoke `/analyze-logging <repo-path>` in a Claude Code session with
   Serena + Context7 enabled.
