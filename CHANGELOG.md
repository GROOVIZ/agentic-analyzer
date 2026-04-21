# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/GROOVIZ/agentic-analyzer/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/GROOVIZ/agentic-analyzer/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/GROOVIZ/agentic-analyzer/releases/tag/v0.1.0
