# The Agentic Analyzer pattern

**One-line definition:** an agent explores a codebase with LLM judgment
(non-deterministic) and produces a schema-validated, replayable, reviewable
inventory (structured output) of a specific kind of thing, classified against a
versioned ruleset, carrying forward human overrides across runs.

This document names the pattern. The rest of the plugin implements it.

## Why the pattern exists

Traditional static analysis is deterministic and narrow: a linter finds exactly
what its author anticipated. An LLM can find the "things like this one I've
never seen before" — custom wrappers, legacy annotations, ad-hoc maps that act
as caches — but its output is non-reproducible, unreviewable, and forgets every
correction the moment the session ends.

The pattern is: keep the **exploration non-deterministic**, keep the **output
deterministic**. Every entry the LLM emits is (a) tied to a line range and a
content hash so it can be regenerated, (b) tagged with the rule that fired so
the decision is auditable, (c) keyed so a human's override from last week can
be replayed this week.

## Target shape: domain definition

An *analyzer* is a domain-specific instance of the pattern. A domain supplies:

| What | Example (caches) | Example (logging) |
|---|---|---|
| **Name of the thing** | cache | log call-site |
| **A target/context** | multi-replica OpenShift | PII-regulated environment |
| **Framework surfaces** | `@Cacheable`, `CaffeineCache`, `ehcache.xml` | `Logger.info`, `SLF4J`, `logback.xml` |
| **Discovery phases** | framework → symbolic → ad-hoc + config | framework → symbolic → message-template extraction |
| **Classification rules** | R0..R11 | L0..Ln |
| **Identity key** | `cache_id + snippet_normalized_sha256` | `call_site_id + snippet_normalized_sha256` |
| **Decisions** | retain / externalize / remove / needs_review | allow / redact / remove / needs_review |

Everything else — the schemas, the fixture runner, the override engine, the
coverage ledger, the review app — is *shared runtime* that every analyzer uses
without modification.

## The twelve invariants

Any analyzer built on this pattern must satisfy all twelve. They are the
pattern's definition.

1. **One target question.** The analyzer answers a single, finite question per
   entry. Decisions belong to a small closed set (≤6 labels including
   `needs_review`).
2. **Multi-phase discovery.** At least two phases, progressing from broad
   (framework/docs) to narrow (symbol-level) to correlated (config, ad-hoc,
   imperative). Phase boundaries are schema-gated.
3. **Evidence per entry.** Every entry carries `source.file`, `line_start`,
   `line_end`, a snippet, a raw-snippet hash, and a normalized-snippet hash.
4. **Ordered, labeled rules.** Rules have stable labels (R0, R1, R2, ...) and
   a separate evaluation order. First rule to fire decides. Rules are versioned
   (`ruleset_version`).
5. **Versioned outputs.** `schema_version`, `ruleset_version`, `run_id`,
   `repository.commit` appear in every `analysis.json`.
6. **Schema-validated boundaries.** Every phase output, the final analysis,
   the coverage report, and the overrides file are JSON-schema validated.
   Validation failure is hard-fail; missing soft prerequisites (docs fetcher,
   LSP index coverage) are recorded as `degradations[]`.
7. **Coverage ledger.** A first-class `coverage.json` sibling reports what was
   scanned, what was skipped, and why. It is not optional.
8. **Replayable overrides.** Human decisions persist in a repo-level file,
   keyed by `(entity_id, snippet_normalized_sha256)`. Whitespace edits do not
   invalidate a replay. Orphaned overrides stay until their target reappears.
9. **Decision source.** Every entry records whether its decision came from
   the rule engine (`"rule"`) or a replayed override (`"override"`).
10. **Confidence.** Every entry records `high | medium | low`, reflecting
    evidence quality (symbol resolution, framework doc availability, rule
    cleanness).
11. **Fixture harness.** The analyzer ships with golden fixtures, each with an
    `expected.json`, and a comparator. A regression is a diff, not an opinion.
12. **Deterministic identity.** The identity key is designed so the same
    cache/log-call/flag in the same file receives the same ID across runs,
    commits, and whitespace edits. Identity is the contract between the agent
    and the override engine.

## What the plugin ships

The plugin provides two layers:

**Shared runtime (`_core/`):** everything that does not change between domains.
Schemas for coverage, overrides, fixture manifests; bin utilities for
validation, snippet normalization, fixture comparison, override replay; skill
templates and fragment prompts for common phase shapes; documentation of the
invariants.

**Authoring tools:** a meta-skill `/new-analyzer` that scaffolds a new
analyzer skill from the templates; agent definitions (`rule-author`,
`schema-author`, `fixture-author`, `analyzer-reviewer`) that specialise in the
sub-tasks of authoring an analyzer.

## What the plugin does *not* do

- It does not generalise over target topologies. Each analyzer hard-codes its
  target (e.g., multi-replica OpenShift, PII-regulated environment, ...) at
  scaffold time. Changing target is a new analyzer.
- It does not ship a ruleset editor or a visual rule builder. Rules are
  markdown authored by engineers.
- It does not run the analysis itself — a Claude Code session running the
  scaffolded skill does. The plugin is the authoring kit, not the inference
  engine.

## Non-goals

- Cross-language analyzer support via bespoke parsers. The pattern assumes
  Serena's LSP handles the target-repo language; a scaffolded analyzer that
  can't rely on symbolic enumeration has to fall back to Glob/Grep.
- Distributed override storage. The overrides file is a repo-local JSON blob;
  concurrent edits are the user's problem.
- A production review app. The pattern's override schema is stable and
  documented; adapting or building a review UI is a separate initiative.
