# agentic-analyzer plugin

The authoring kit. Scaffolds a new domain-specific analyzer skill via
an interactive interview, ships five specialist subagents, and provides
the `_core/` runtime (schema validator, snippet normalizer, fixture
comparator, override-replay engine, scaffold validator, entity-oracle
comparator). Analyzers produced by this kit record per-entity
`properties` bags as structured evidence, consult an optional dev-team
oracle to backstop discovery, and run a Phase D.5 consolidation pass
to fill in any rule-declared property keys the classifier didn't emit.

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
npm --prefix _core test     # node --test, all green
```

## Scaffolding a new analyzer

Run `/new-analyzer` inside a Claude Code session with the target repo as
the working directory (or pass its path as the first argument). The
command interviews you:

1. The target question (one sentence).
2. Confirm derived naming (analyzer_name, entity, id_field).
3. Confirm scanned repo context (language, source roots, frameworks).
4. Pick a decision set and target_const.

`/new-analyzer` then dispatches the `rule-author` agent to draft
`rules.md`, surfaces any uncertainties it flagged, stamps the skill at
`.claude/skills/analyze-<name>/`, generates one stub fixture per rule
via `fixture-init.mjs`, optionally seeds an `expected-entities.json`
oracle from team-supplied input, and runs `validate-scaffold.mjs` as
a hard quality gate before declaring success.

The scaffolded fixtures are TODO-marked stubs: the author still fills
in `target/*` source files and the expected decisions before each
fixture passes the comparator. The `fixture-author` agent helps with
that authoring.

## From scaffold to a running analyzer

After scaffolding with `/new-analyzer`:

1. **Populate the skeleton** (the creative core):

   - Review `rules.md` drafted by `rule-author` and refine as needed.
   - Fill in `prompts/discovery.md` with the libraries to probe and
     your identity convention. The `schema-author` subagent helps
     if you want to extend the base analysis schema.

2. **Seed a fixture** per rule. From the scaffolded skill dir:

   ```
   node bin/fixture-init.mjs \
     --dir=../logging-analysis/fixtures/simple-info-log \
     --id-field=call_site_id
   ```

   The `fixture-author` subagent helps design each fixture
   (minimal target tree, one rule per fixture, `forbidden[]` for
   drop-rule coverage).

3. **Run** in a Claude Code session with the Serena + Context7 MCP
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
| `/agentic-analyzer:new-analyzer` | Stamps templates + runtime into `.claude/skills/analyze-<name>/`, generates one stub fixture per rule, optionally seeds an expected-entities oracle, and gates success on `validate-scaffold.mjs`. |
| `/agentic-analyzer:expected-entities` | Maintains a target-repo-level dev-team oracle list at `<analyzer>-analysis/expected-entities.json`. Accepts a file path or a free-form quoted string; dispatches `entity-list-ingestor` to normalize. Optional `--run-compare` for a gap report against the latest `analysis.json`. |
| `agents/rule-author.md` | Writes the rule table. Enforces stable labels + separate evaluation order + catch-all. Declares each rule's `Properties to set` column for Phase D emission. |
| `agents/schema-author.md` | Extends base schemas with domain fields without breaking identity. |
| `agents/fixture-author.md` | Authors golden fixtures, one rule at a time. |
| `agents/entity-list-ingestor.md` | Dispatch-only. Normalizes arbitrary team input (comment, pasted list, CSV-ish text) into the canonical `expected-entities.json` shape; refuses to invent names and surfaces ambiguities as `uncertainties[]`. |
| `agents/analyzer-reviewer.md` | Adversarial pattern reviewer. Runs the twelve-invariant checklist plus Oracle/C.2 and Properties/D.5 sections. Verdicts: `OK` / `OK-with-notes` / `blocked`. |

### Shared runtime (`_core/bin/`)

| CLI | Role |
|---|---|
| `validate.mjs` | JSON-Schema validator (Ajv 2020 + formats). |
| `validate-scaffold.mjs` | Post-stamp quality gate: required files, placeholder leaks, `SKILL.md` frontmatter, fixture coverage via `--rule-ids=<csv>`, rules.md ID-column cross-check. Run as the final step of `/new-analyzer`. |
| `normalize.mjs` | Snippet normalizer → `snippet_normalized_sha256`, the override-replay identity key. Whitespace-invariant, semantic-changes-visible. |
| `compare-fixture.mjs` | Parameterised fixture comparator (`--entity-key`, `--id-field`). |
| `compare-entities.mjs` | Dev-team oracle ↔ `analysis.json` gap reporter. Sections: `MISSED` / `AMBIGUOUS` / `DECISION-MISMATCH` / `SUSPICIOUS`. Exit 0 clean, 1 on gaps. |
| `replay-overrides.mjs` | Applies v2 overrides to `analysis.json`. Matches by `(<id_field>, snippet_normalized_sha256)`. |
| `migrate-overrides-v1-v2.mjs` | One-way migrator with backup. |
| `fixture-init.mjs` | Seeds a fixture dir (positive or negative). Rule-id is format-gated upstream by `stamp.mjs` (`/^[A-Za-z0-9_-]+$/`). |
| `stamp.mjs` | Atomic template stamping (stage → rename). Path-escape defended, symlink-rejecting, rule-id format-validated. |

### Templates (`_core/templates/`)

Eight `.tmpl` files: `SKILL.md`, `package.json`,
`prompts/discovery.md`, `prompts/classification.md`,
`prompts/properties.md`, and four schemas (candidates, analysis,
coverage, overrides). (`rules.md` is not a template — it's written
by `/new-analyzer` directly from the `rule-author` dispatch envelope,
with an authored `Properties to set` column per rule.) Placeholders are
`{{UPPER_SNAKE}}` tokens (`[A-Z0-9_]+`); unknown tokens are a hard error.

A separate non-templated schema at `_core/schema/expected-entities.schema.json`
is shared across all analyzers (not per-analyzer stamped) and governs
the dev-team oracle list consumed by the Phase C.2 discovery backstop.

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
