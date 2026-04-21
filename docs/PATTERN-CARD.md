# Agentic Analyzer — Pattern Card

One-page reference for authors. Full definition at
[`pattern.md`](pattern.md); this is the checklist.

## The twelve invariants

1. **Target question.** One sentence, closed decision set (≤6 labels
   including `needs_review`).
2. **Multi-phase discovery.** Broad → narrow → correlated. Phase
   boundaries are schema-gated.
3. **Evidence per entry.** `source.file`, `line_start`, `line_end`,
   `snippet`, `snippet_sha256`, `snippet_normalized_sha256`.
4. **Ordered, labeled rules.** R-labels stable; evaluation order
   separate. First rule to fire decides.
5. **Versioned outputs.** `schema_version`, `ruleset_version`,
   `run_id`, `repository.commit`.
6. **Schema-validated boundaries.** Hard-fail on schema; soft-fail on
   degradations (recorded in `coverage.json`).
7. **Coverage ledger.** First-class sibling to `analysis.json`.
8. **Replayable overrides.** Keyed by `(entity_id,
   snippet_normalized_sha256)`. Survive whitespace edits. Orphans
   preserved, never deleted.
9. **Decision source.** `"rule"` or `"override"` on every entry.
10. **Confidence.** `high | medium | low` on every entry.
11. **Fixture harness.** Golden fixtures, one rule each. `expected[]`
    / `forbidden[]` for positive / drop-rule coverage.
12. **Deterministic identity.** Same source → same id across runs,
    commits, and whitespace edits.

## Scaffolding flow

```
config.json  ──►  /new-analyzer  ──►  .claude/skills/analyze-<name>/
                                        ├── SKILL.md
                                        ├── rules.md            author fills in
                                        ├── prompts/
                                        │   ├── discovery.md    author fills in
                                        │   └── classification.md
                                        ├── schema/
                                        │   ├── analysis.schema.json
                                        │   ├── candidates.schema.json
                                        │   ├── coverage.schema.json
                                        │   └── overrides.schema.json
                                        ├── bin/                verbatim from _core
                                        └── package.json
```

## Runtime phases (scaffolded SKILL.md)

```
1  Preflight       path, Serena, Context7, run-id, mkdir output
2  Phase A         framework survey (Context7)            → _phaseA.json
3  Phase B         symbolic enumeration (Serena)          → _phaseB.json
4  Phase C         ad-hoc + config correlation (optional) → candidates.json
5  Phase D         rule classification                    → analysis.json
6  Coverage        degradations, counters                 → coverage.json
7  Override replay (entity_id + snippet hash) match       → analysis.json mutated
8  Latest pointer  printf '%s' <run-id> > latest.txt
9  Summary         print to session
```

Each arrow is a schema-gated boundary. `validate.mjs` runs between
every pair; non-zero exit aborts the run.

## Decision cells

| decision | rule_fired | decision_source | stage |
|---|---|---|---|
| `<your-enum>` | `R1..R<last>` | `rule` | Phase D output |
| `<your-enum>` | `R1..R<last>` | `override` | after replay |
| `null` | `R<last>` (catch-all) | `rule` | Phase D output |
| `null` | `R<last>` | `override` | flag-only override |

`decision_source: "override"` entries have `confidence` either set by
the reviewer (optional field on the override) or defaulted to `"low"`.

## Identity formula

```
entity_id        := <convention>, e.g. java:<file>:<class>.<method>:<name>
source.snippet_normalized_sha256 := sha256(normalize(30-line window))
override key     := (entity_id, snippet_normalized_sha256)
```

`normalize()` — CRLF → LF; runs of whitespace → single space; blank
lines stripped. Whitespace-invariant, semantic-changes-visible.

## Rule evaluation order template

1. Drop rule — short-circuit before any classification (e.g., R0 "not
   a thing"). Optional.
2. Cheap errors — dead code, structural duplicates, broken semantics.
3. Identity-driven — data shape forces decision.
4. Target-topology — scope/context forces decision.
5. Happy-path split — base case with one axis (mutability, size,
   provider).
6. Framework-specific split — same axis, framework-annotation variant.
7. Catch-all (`R<last>`) — everything else → `needs_review`.

## Confidence

| level | fires when |
|---|---|
| **high** | single rule fired cleanly OR evaluation order broke a tie between clear matches; Serena resolved all symbols; Context7 available |
| **medium** | decision reached despite partial symbol resolution OR subjective interpretation was required |
| **low** | any symbol unresolved OR Context7 unavailable for the framework in scope OR catch-all fired OR override applied without explicit confidence |

## Coverage degradation stages

Closed enum in `coverage.schema.json`:

```
context7          plugin unavailable
serena            plugin unavailable
phase-a           framework-survey issue
phase-b           symbolic-enumeration issue
phase-c           ad-hoc/config issue
classification    rule-matching issue
override-replay   overrides.json problem
other             escape hatch
```

## Anti-patterns

- A rule whose evidence can't be quoted from source. You don't have a
  rule — you have a guess.
- A fixture that exercises two rules. First rule change, fixture becomes
  a liability.
- Duplicating reviewer feedback into `analysis.json`. Feedback lives in
  `overrides.json#feedback[]`.
- Renumbering rule labels between versions. Labels are stable forever.
- Changing identity formula for an existing analyzer. Overrides break
  across the board.

## Subagents (use them)

- `rule-author` — writing the rule table.
- `schema-author` — extending base schemas safely.
- `fixture-author` — one-rule-at-a-time golden fixtures.
- `analyzer-reviewer` — adversarial twelve-invariant checklist.
