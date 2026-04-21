# Example scaffolded analyzer — `analyze-logging`

This directory is the **output** of running `/new-analyzer` for a
PII-regulated logging analyzer (Java, slf4j + logback). It exists in
the repo as a worked example so readers can see what the v0.2.0
interactive scaffolder produces before they run it themselves.

**Status:** skeleton only. `rules.md` contains the structural template
that the `rule-author` agent's dispatch envelope produces; the rule
table itself (`L1`..`L5`) is a placeholder a real author would fill in
with concrete triggers. `prompts/discovery.md` is fully substituted
(framework list, manifest list, source roots, identity convention all
concrete) — no `*fill in for your domain*` placeholders remain.

## How it was produced

In a Claude Code session with the `agentic-analyzer` plugin installed:

```
/agentic-analyzer:new-analyzer
```

The command interviewed for:

- **Target question:** "Should this log call be allowed under PII rules?"
- **Naming:** `analyzer_name=logging`, `entity_name_human=Log call-site`,
  `entity_key=entries`, `id_field=call_site_id`.
- **Repo context:** `language=java`, `frameworks=[slf4j, logback]`,
  `source_roots=[src/main/java]`,
  `manifest_list=[pom.xml, build.gradle, build.gradle.kts]`.
- **Decisions / target:** `decision_enum=[allow, redact, remove]`,
  `target_const=pii-regulated`.

It then dispatched the `rule-author` agent in `MODE: dispatch` to draft
`rules.md`, ran `stamp.mjs` against the templates, and copied the
runtime utilities into `bin/`.

## What's in here

| Path | Purpose |
|---|---|
| `SKILL.md` | The skill a Claude Code session invokes as `/analyze-logging`. Description embeds the target question. Refers to `$SKILL_DIR/bin/...` for the runtime utilities. |
| `rules.md` | Skeleton rule table. Author fills in L1..L5 with concrete triggers. |
| `prompts/discovery.md` | Phase A/B/C prompt with the logging-specific framework list, manifest list, source roots, identity convention, and Phase C hint already substituted. |
| `prompts/classification.md` | Phase D prompt. Mostly domain-agnostic. |
| `schema/analysis.schema.json` | Stamped from the template. `target` const is `"pii-regulated"`. Entity key is `entries`, id field is `call_site_id`. `rule_fired` enum is `[L1..L5, none]`. |
| `schema/candidates.schema.json` | Stamped intermediate-output schema. |
| `schema/coverage.schema.json` | Stamped coverage-report schema (mostly domain-agnostic). |
| `schema/overrides.schema.json` | Stamped override file schema with `call_site_id` as the identity key. |
| `bin/*.mjs` | Verbatim copies of the `_core` runtime utilities. |
| `package.json` | The scaffolded skill's own ajv dependency. `npm install` to make the validator runnable. |

## What a real author would do next

1. `cd examples/analyze-logging && npm install`.
2. Populate `rules.md` with concrete rules (e.g., "L2: message contains a
   PII regex known to the logback masking config" → `redact`).
3. Run `/fixture-author` to author golden fixtures under
   `../logging-analysis/fixtures/<name>/` with minimal target trees and
   `expected.json`.
4. Invoke `/analyze-logging <repo-path>` in a Claude Code session with
   Serena + Context7 enabled.
