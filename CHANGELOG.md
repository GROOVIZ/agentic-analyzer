# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Phase C.2 step 5: role-expansion.** The expected-entities
  backstop now extends beyond same-framework similarity. After
  framework-expansion (step 4), a new `role-inferencer` subagent
  (dispatch-only) analyses the oracle-resolved sites and proposes
  one or more search strategies with per-criterion evidence,
  self-assessed confidence, and mandatory negative examples.
  SKILL.md tier-gates the strategies: autonomous execution when
  confidence is `high`, interactive Accept/Refine/Reject/Skip when
  `medium` or `low`, skip path when
  `AGENTIC_ANALYZER_NONINTERACTIVE=1` (CI compatibility). Candidates
  are tagged `"phase": "C.2-role-expansion"` and capped at 200 per
  run. Rank-1 strategy only; lower-ranked strategies become
  `uncertainties[]` the author can promote manually.
- **Role-inferencer envelope schema** at
  `_core/schema/role-inferencer-envelope.schema.json`. Shared,
  non-templated. Validates the subagent's output before execution:
  rejects envelopes missing `strategies[]`, criteria without
  `evidence[]`, unknown `strategy_type` values, or fewer than 3
  `negative_examples`. Invalid envelopes become a
  `phase-c-expansion` degradation rather than execution attempts.
- **`strategy_type` field** on `coverage.degradations[]` entries
  (optional, enum: `framework` / `annotation` / `call_pattern` /
  `name_pattern` / `path_pattern` / `combination`). Lets consumers
  filter degradations by expansion flavour without parsing the
  `reason` prose.
- **`AGENTIC_ANALYZER_NONINTERACTIVE` env var.** When set to `1` /
  `true` / `yes` (case-insensitive), low-confidence role-expansion
  strategies are skipped with a `role-expansion-skipped`
  degradation instead of prompting for user approval. Makes
  `/analyze-<name>` CI-safe.

### Documentation

- `agents/analyzer-reviewer.md` extended with an 11-item
  Role-expansion checklist section.
- `docs/PATTERN-CARD.md` runtime phases block now enumerates step 4
  (framework-expansion) and step 5 (role-expansion) separately;
  degradation stages block documents the new `strategy_type` field.

## [0.3.0] — 2026-04-22

### Added

- **`/expected-entities` command** and **`entity-list-ingestor` subagent**.
  Accept free-form dev-team input (file path, plain-text name list, pasted
  comment, mixed-format table) and normalize it into a canonical
  `<target>/<analyzer>-analysis/expected-entities.json` file, schema-validated
  via a new shared schema at `_core/schema/expected-entities.schema.json`.
  Target-repo-level artifact, mirroring the `overrides.json` convention.
- **Phase C.2 expected-entities backstop** in `prompts/discovery.md.tmpl`.
  For each name in the oracle, a targeted `endsWith(":" + name)` search runs
  across source roots; any hit whose framework is not in `frameworks[]`
  emits a `phase-a-gap` degradation clustered per framework. Clusters with
  ≥2 hits trigger a within-run framework expansion (Context7 survey + Serena
  enumeration) capped at 200 candidates per framework, non-recursive, with
  `phase-c-expansion` telemetry emitted both on successful expansion and
  cap-reached paths. `phase-a-gap` emits regardless of expansion so the
  persistence signal to the author is intact.
- **New coverage degradation stages:** `phase-a-gap` and `phase-c-expansion`.
- **`_core/bin/validate-scaffold.mjs`** post-stamp quality gate invoked at
  the end of `/new-analyzer`. Checks: required files present, no unresolved
  `{{PLACEHOLDER}}` tokens, `SKILL.md` YAML frontmatter sanity, optional
  `--rule-ids=<csv>` fixture coverage, and an ID-column cross-check of the
  rules.md table against the CLI rule-ids.
- **`_core/bin/compare-entities.mjs`** — oracle ↔ `analysis.json` gap
  reporter. Sections: `MATCHED`, `MISSED`, `AMBIGUOUS`, `DECISION-MISMATCH`,
  `SUSPICIOUS` (post-parse linter flagging likely ingestor drift). Supports
  `--case-insensitive`. Exit 0 on clean, 1 on gaps.
- **Per-entity `properties` bag** on the stamped `analysis.schema.json`
  entry schema. Optional object, values restricted to primitives (string,
  number, boolean, null) via `oneOf`. Arrays and nested objects fail
  validation.
- **`Properties to set` 4th column** in the rule-author-authored `rules.md`
  table. Each non-catch-all rule declares a comma-separated list of property
  keys it is responsible for populating. Catch-all rows leave the cell blank.
- **Classification-time side-effect emission of declared properties.** The
  classifier populates each entry's `properties` object with the keys from
  the rule's `Properties to set` column at rule-fire. Non-primitive values
  fail schema validation. Confidence tie-break with the existing
  Serena-unresolved rule: `low` remains the floor when applicable.
- **Phase D.5 — Property consolidation.** New Step 5.5 in `SKILL.md.tmpl`
  runs after Phase D classification. For every non-catch-all entry whose
  declared keys are not yet populated, the new `prompts/properties.md`
  extraction prompt reads the snippet (+ a 15-lines-before/15-lines-after
  window of `source.file`) and returns a partial `properties` object with
  primitive values or `null`. The orchestrator merges it into the entry and
  appends a `coverage.degradations[]` entry (stage `"classification"`,
  `reason: "property extraction failed: <key> for rule <rule_fired>"`) for
  any `null` outcomes. Phase D.5 is strictly additive — never modifies
  `decision`, `rule_fired`, `rationale`, or `confidence`.
- **`/new-analyzer` fixture auto-generation (Step 8).** Loops `rule_ids`,
  calls `fixture-init.mjs` per rule with `--positive` or `--negative`
  inferred from the Decision column (`dropped` → `--negative`). Honest
  per-rule success/failure reporting; no false "abort" when one rule fails.
- **`/new-analyzer` optional expected-entities seeding (Step 9).** Prompts
  for file path, pasted text, or `skip`; dispatches `entity-list-ingestor`,
  shows parsed entities + uncertainties for confirmation, writes the
  canonical file under the target repo, validates.
- **`/new-analyzer` post-stamp quality gate (Step 10).** Runs
  `validate-scaffold.mjs --rule-ids=...` as a hard gate on the success
  summary.
- **Variable-model preamble** in both `/new-analyzer` and the stamped
  `SKILL.md.tmpl`. Explicitly distinguishes `$CLAUDE_PLUGIN_ROOT` (real env
  var, persists across Bash tool calls) from LLM-held placeholders
  (`$TARGET_ROOT`, `$SKILL_DIR`, `$ANALYZER_NAME`, `$TMP_CONFIG`,
  `$PLUGIN_ROOT`) that must be substituted literally at each use. Fixes the
  shell-state-not-persisting drift that previously caused partial scaffolds.
- **`analyzer-reviewer` checklist sections** for the new subsystems:
  *Oracle / Phase C.2 backstop* (clustering, cap, non-recursion, null →
  degradation pairing) and *Properties (Phase D / D.5)* (declared-key
  coverage, primitive-only values, catch-all `properties: {}`, null
  auditability).
- **`PATTERN-CARD.md` runtime phases** now list Phase D.5 (5.5) with cost
  note + additive-boundary semantics, and the degradation-stages block now
  documents `phase-a-gap` and `phase-c-expansion`.

### Changed

- `discovery.md.tmpl` Phase A now explicitly handles the empty-frameworks
  edge case (skip steps 3–4 when `frameworks[] = []`; the never-matching
  regex `/(?!)/i` would otherwise silently no-op).
- `SKILL.md.tmpl` Step 4 prose compressed to a pointer into
  `prompts/discovery.md §Phase C`, which is now authoritative for both
  C.1 (ad-hoc/config correlation, optional per domain) and C.2 (oracle
  backstop, runs when the oracle file exists).
- `examples/analyze-logging/rules.md` regenerated with the 4-column table
  so the example tracks the new rule-author contract.

### Security

- `stamp.mjs` now validates each `rule_ids[]` element against
  `/^[A-Za-z0-9_-]+$/`. Closes the path-escape vector where a malformed
  rule-id reached `fixture-init.mjs --dir=<SKILL_DIR>/fixtures/<rule-id>`
  unvalidated, enabling traversal via `..`.

### Documentation

- New implementation plan at
  `docs/superpowers/plans/2026-04-22-entity-properties.md` documents the
  Phase D.5 / properties feature start-to-finish.
- `.gitignore` extended for `.serena/` (Serena MCP per-project working state).

## [0.2.0] — 2026-04-21

### Breaking

- `/new-analyzer` no longer takes a `config.json` argument. Run it with an
  optional target-root path; it interviews you for the rest. Any existing
  `config.json` files are obsolete.
- `stamp.mjs` required-key shape changed: `emittable_rule_ids` renamed to
  `rule_ids`; new required keys `language`, `frameworks`, `source_roots`,
  `manifest_list`, `target_question`.
- `stamp.mjs` no longer produces `rules.md` — it's written directly by
  `/new-analyzer` after dispatching the `rule-author` agent.

### Added

- `rule-author` agent gained a `MODE: dispatch` that returns a JSON envelope
  `{ ruleset_version, rules_md, rule_ids, uncertainties }` consumed by
  `/new-analyzer`.
- New substitution tokens in templates: `{{LANGUAGE}}`, `{{FRAMEWORK_LIST}}`,
  `{{FRAMEWORK_REGEX}}`, `{{MANIFEST_LIST}}`, `{{SOURCE_ROOTS}}`,
  `{{TARGET_QUESTION}}`, `{{IDENTITY_CONVENTION}}`, `{{PHASE_C_HINT}}`.
- `discovery.md.tmpl` Phase A/B/C now embed concrete values instead of
  `*fill in for your domain*` placeholders.
- Schemas now live under `_core/templates/schema/` and stamp into
  `<skill>/schema/*.schema.json` directly — no post-stamp `mv` step.
- `SKILL.md.tmpl` modernized for cross-platform execution: uses Claude's
  `Read`/`Write` tools and `node -e` one-liners instead of
  `realpath`/`test`/`cat`/`printf`/`rm`.
- `stamp.mjs` `decision_enum` now validates per-element (each member must
  be a non-empty string), matching the validation style of the new keys.
- `_core/bin/replay-overrides.test.mjs` — new tests for the overrides
  replay engine.
- `marketplace.json` and `plugin.json` realigned with the upstream
  Anthropic schema; URLs corrected from `example/` to `GROOVIZ/`.
- Agent description rewording for consistency (4 specialist agents).
- `_core/.gitignore` extended with `*.log`, `.DS_Store`, `Thumbs.db`.

### Removed

- `_core/templates/rules.md.tmpl`.
- `examples/logging-config.json`.

## [0.1.0] — 2026-04-21

Initial release.

### Added

- **Plugin marketplace manifest** at `.claude-plugin/marketplace.json`.
  The repo is simultaneously a single-plugin installable source *and*
  a marketplace catalog — users can subscribe once via
  `claude plugin marketplace add <url>` and receive future plugins
  (pre-built analyzers for caches, logging, feature flags, ...) as
  they land, without re-installing.
- `/agentic-analyzer:new-analyzer` command — scaffolds a new
  domain-specific analyzer skill from a seven-field JSON config.
- Four specialist subagents: `rule-author`, `schema-author`,
  `fixture-author`, `analyzer-reviewer`.
- `_core/` runtime: seven Node CLIs covered by `node --test`.
  - `validate.mjs` — JSON-Schema validator (Ajv 2020).
  - `normalize.mjs` — snippet normalizer (produces
    `snippet_normalized_sha256`, the override-replay identity key).
  - `compare-fixture.mjs` — parameterised golden-fixture comparator.
  - `replay-overrides.mjs` — applies v2 overrides to `analysis.json`.
  - `migrate-overrides-v1-v2.mjs` — one-way migrator with backup.
  - `stamp.mjs` — atomic template stamping engine with path-escape
    defense and symlink rejection.
  - `fixture-init.mjs` — seeds a fixture directory (positive or
    negative).
- Seven templates in `_core/templates/`: `SKILL.md`, `rules.md`,
  `prompts/discovery.md`, `prompts/classification.md`, and four JSON
  schemas (candidates, analysis, coverage, overrides).
- Worked example: `examples/analyze-logging/` — a freshly-scaffolded
  analyzer for a PII-regulated logging domain, showing what the
  scaffolder produces before the author fills in rules.
- Pattern specification (`docs/pattern.md`) documenting the twelve
  invariants every analyzer must satisfy, plus a one-page card
  (`docs/PATTERN-CARD.md`) and an install guide (`docs/INSTALL.md`).

### Security

- `stamp.mjs` rejects symlinks in the templates tree
  (`lstatSync`-gated walk).
- `stamp.mjs` path-escape check (`path.resolve` + prefix assertion).
- `stamp.mjs` is atomic: stages to `<outDir>.staging-<rand>`, renames
  on success, `rm -rf` on throw. No partial state after failure.
- `/new-analyzer` extracts `analyzer_name` via argv-passthrough, not
  shell interpolation — no injection surface from config values.

[Unreleased]: https://github.com/GROOVIZ/agentic-analyzer/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/GROOVIZ/agentic-analyzer/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/GROOVIZ/agentic-analyzer/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/GROOVIZ/agentic-analyzer/releases/tag/v0.1.0
