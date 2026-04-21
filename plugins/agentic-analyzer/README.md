# agentic-analyzer plugin

The authoring kit. Scaffolds a new domain-specific analyzer skill from
a seven-field config, ships four specialist subagents, and provides the
`_core/` runtime (validator, snippet normalizer, fixture comparator,
override-replay engine).

**Part of the `agentic-analyzer` marketplace** — see the
[repo-root README](../../README.md) for marketplace-level install and
the full list of plugins.

> **Pattern.** This plugin implements the authoring side of the
> agentic-analyzer pattern — twelve invariants documented at
> [`../../docs/pattern.md`](../../docs/pattern.md), one-page card at
> [`../../docs/PATTERN-CARD.md`](../../docs/PATTERN-CARD.md).

## Install (from the marketplace)

```
claude plugin marketplace add <marketplace-url>
claude plugin install agentic-analyzer@agentic-analyzer
```

Plain plugin install (without adding the marketplace) also works —
see [`../../docs/INSTALL.md`](../../docs/INSTALL.md).

Prerequisite: the `_core/` runtime needs Ajv. Once the plugin is
installed, from the plugin directory:

```
npm --prefix _core install
npm --prefix _core test     # 71 tests, all green
```

## The five minutes from scratch to a running analyzer

1. **Write a domain config** — a JSON file with seven required fields
   (see [`../../examples/logging-config.json`](../../examples/logging-config.json)):

   ```json
   {
     "analyzer_name":      "logging",
     "entity_name_human":  "Log call-site",
     "entity_key":         "entries",
     "id_field":           "call_site_id",
     "target_const":       "pii-regulated",
     "decision_enum":      ["allow", "redact", "remove"],
     "emittable_rule_ids": ["L1", "L2", "L3", "L4", "L5"]
   }
   ```

   Two optional booleans control MCP prereqs: `requires_serena`
   (default `true`) and `requires_context7` (default `true`). Set
   either to `false` for analyzers that can degrade gracefully.

2. **Scaffold** in a Claude Code session:

   ```
   /agentic-analyzer:new-analyzer /path/to/logging-config.json
   ```

   The command stamps a new skill at
   `.claude/skills/analyze-logging/` with schemas, rule skeleton,
   prompts skeleton, runtime utilities, and a `package.json`. Atomic:
   failure leaves no partial state; refuses to clobber an existing dir.

3. **Populate the skeleton** (the creative core):

   - Fill in `rules.md` with the domain's rule table and evaluation
     order. Delegate to the `rule-author` subagent for guidance.
   - Fill in `prompts/discovery.md` with the libraries to probe and
     your identity convention. The `schema-author` subagent helps
     if you want to extend the base analysis schema.

4. **Seed a fixture** per rule. From the scaffolded skill dir:

   ```
   node bin/fixture-init.mjs \
     --dir=../logging-analysis/fixtures/simple-info-log \
     --id-field=call_site_id
   ```

   The `fixture-author` subagent helps design each fixture
   (minimal target tree, one rule per fixture, `forbidden[]` for
   drop-rule coverage).

5. **Run** in a Claude Code session with the Serena + Context7 MCP
   plugins enabled:

   ```
   /analyze-logging /path/to/target-repo
   ```

   Every phase is schema-gated; identity is a content-hash pair;
   reviewer overrides replay across runs.

## What you get

### Authoring tools

| Artifact | Role |
|---|---|
| `/agentic-analyzer:new-analyzer` | Stamps templates + runtime into `.claude/skills/analyze-<name>/`. |
| `agents/rule-author.md` | Writes the rule table. Enforces stable labels + separate evaluation order + catch-all. |
| `agents/schema-author.md` | Extends base schemas with domain fields without breaking identity. |
| `agents/fixture-author.md` | Authors golden fixtures, one rule at a time. |
| `agents/analyzer-reviewer.md` | Adversarial pattern reviewer. Runs the twelve-invariant checklist. Verdicts: `OK` / `OK-with-notes` / `blocked`. |

### Shared runtime (`_core/bin/`)

| CLI | Role |
|---|---|
| `validate.mjs` | JSON-Schema validator (Ajv 2020 + formats). |
| `normalize.mjs` | Snippet normalizer → `snippet_normalized_sha256`, the override-replay identity key. Whitespace-invariant, semantic-changes-visible. |
| `compare-fixture.mjs` | Parameterised fixture comparator (`--entity-key`, `--id-field`). |
| `replay-overrides.mjs` | Applies v2 overrides to `analysis.json`. Matches by `(<id_field>, snippet_normalized_sha256)`. |
| `migrate-overrides-v1-v2.mjs` | One-way migrator with backup. |
| `fixture-init.mjs` | Seeds a fixture dir (positive or negative). |
| `stamp.mjs` | Atomic template stamping (stage → rename). Path-escape defended, symlink-rejecting. |

### Templates (`_core/templates/`)

Seven `.tmpl` files: `SKILL.md`, `rules.md`, `prompts/discovery.md`,
`prompts/classification.md`, and four schemas. Placeholders are
`{{UPPER_SNAKE}}` tokens (`[A-Z0-9_]+`); unknown tokens are a hard error.

## Worked example

Lives at the marketplace root:

- [`examples/analyze-logging/`](../../examples/analyze-logging) — a
  freshly-scaffolded analyzer for a PII-regulated logging domain.
  Shows what `/agentic-analyzer:new-analyzer` produces before the
  author fills in rules and prompts.

## Status

**Pre-1.0.** Schemas and CLI contracts may change before 1.0. After 1.0
they will be versioned per semver. Every public promise the plugin
makes is covered by tests; see `_core/bin/*.test.mjs`.

## Contributing

Fork, branch, commit, PR. Run tests before submitting:

```
npm --prefix _core test
```

## License

MIT — see [../../LICENSE](../../LICENSE).
