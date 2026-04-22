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
/new-analyzer interview  ──►  rule-author (MODE:dispatch)  ──►  stamp  ──►  .claude/skills/analyze-<name>/
                                                                             ├── SKILL.md
                                                                             ├── rules.md          rule-author drafts, author iterates
                                                                             ├── prompts/
                                                                             │   ├── discovery.md
                                                                             │   └── classification.md
                                                                             ├── schema/
                                                                             │   ├── analysis.schema.json
                                                                             │   ├── candidates.schema.json
                                                                             │   ├── coverage.schema.json
                                                                             │   └── overrides.schema.json
                                                                             ├── fixtures/         one stub per rule_id
                                                                             │   └── <rule-id>/…
                                                                             ├── bin/              verbatim from _core
                                                                             └── package.json
```

`/new-analyzer` takes no JSON input — the interview infers repo context, the
rule-author subagent drafts `rules.md`, and `fixture-init.mjs` seeds one stub
fixture per rule. An optional Step 9 seeds a dev-team oracle at
`<target>/<analyzer>-analysis/expected-entities.json`, consulted by Phase C.2
of every `/analyze-<name>` run.

## Oracle feedback loop (Phase C.2)

`/new-analyzer` (Step 9) or `/expected-entities` maintains the oracle at
`<target>/<analyzer>-analysis/expected-entities.json`. Every `/analyze-<name>`
run consults it via three expansion mechanisms, each additive, each
bounded:

1. **Step 3 — backstop search.** Each oracle `name` is resolved by
   Serena `find_symbol` (or `search_for_pattern` / `Grep` fallback).
   Zero-hit names emit a `stage: "phase-c"` degradation; multi-hit
   names disambiguate via first-resolution (author can tighten the
   name in the oracle if that's wrong).
2. **Step 4 — framework-expansion.** When ≥2 resolved sites share a
   framework/library not in `frameworks[]`, the analyzer auto-surveys
   that framework (Context7 docs + Serena enumeration), capped at 200
   candidates. Emits `stage: "phase-a-gap"` (persistent signal: add
   the library to `frameworks[]`) and `stage: "phase-c-expansion"`
   (telemetry, with `strategy_type: "framework"`).
3. **Step 5 — role-expansion.** The `role-inferencer` subagent reads
   the resolved sites' imports + call chains + enclosing symbols and
   proposes search strategies for entities playing the same *role*
   (not just same framework). Each strategy has a `strategy_type`
   (`annotation` / `call_pattern` / `name_pattern` / `path_pattern` /
   `combination`), evidence-grounded criteria, and self-assessed
   confidence. Tier-gated: `high` → autonomous; `medium`/`low` →
   interactive Accept/Refine/Reject/Skip, or skipped with
   `AGENTIC_ANALYZER_NONINTERACTIVE=1`. Capped at 200 candidates per
   strategy; rank-1 only per run. Emits `strategy_type: <type>` on
   the degradation.

**Author's read-after-run contract.** Scan `coverage.degradations[]`:

- `phase-a-gap` entries name a library the oracle proved is missing
  from `frameworks[]`. Add it; next run's Phase A catches it at the
  source.
- `phase-c-expansion` entries log what each auto-expansion did. A
  `cap-reached` entry says "200 isn't enough — add the library or
  refine the oracle." A `user-approved` entry is the record of your
  interactive choice.
- `role-expansion-rejected` entries log a strategy you declined —
  useful if the same pattern keeps getting proposed and you need to
  tune the oracle to stop evoking it.

## Runtime phases (scaffolded SKILL.md)

```
1  Preflight       path, Serena, Context7, run-id, mkdir output
2  Phase A         framework survey (Context7)            → _phaseA.json
3  Phase B         symbolic enumeration (Serena)          → _phaseB.json
4  Phase C         C.1 ad-hoc + config (optional per domain)
                    C.2 expected-entities backstop (runs when oracle file exists):
                        step 4 framework-expansion (cluster ≥2 hits on library
                          not in frameworks[], Context7+Serena survey, cap 200)
                        step 5 role-expansion (role-inferencer subagent proposes
                          search strategies; tier-gated autonomous/interactive/
                          skip on AGENTIC_ANALYZER_NONINTERACTIVE; cap 200
                          per strategy; rank-1 only)
                    → candidates.json
5   Phase D         rule classification + side-effect properties → analysis.json
5.5 Phase D.5       property consolidation (dedicated extraction for keys
                    declared by rule but missing from side-effect output;
                    appends nulls + degradations for unresolvable keys)
                    → analysis.json (additive)
6   Coverage        degradations, counters                 → coverage.json
7  Override replay (entity_id + snippet hash) match       → analysis.json mutated
8  Latest pointer  printf '%s' <run-id> > latest.txt
9  Summary         print to session
```

Each arrow is a schema-gated boundary. `validate.mjs` runs between
every pair; non-zero exit aborts the run.

Phase D.5 is strictly additive on each entry's `properties` object —
it never rewrites decisions or rules. The schema boundary between 5.5
and 6 is the same `analysis.schema.json` as between 5 and 5.5; additive
primitive-only writes cannot fail in principle, so the re-validation
is belt-and-braces rather than a true gate.

**Cost note.** Phase D.5 makes one extra LLM round-trip per non-catch-all
entry that has any declared key missing from Phase D's side-effect
output. On a classifier that routinely forgets declared keys, this
roughly doubles the per-entry LLM cost of a run. The cure is to tighten
the classification prompt so D.5 rarely fires — D.5 exists as a safety
net, not a substitute for disciplined emission in Phase D.

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
context7            plugin unavailable
serena              plugin unavailable
phase-a             framework-survey issue
phase-a-gap         oracle resolved an entity via Phase C.2; its framework is
                    not in frameworks[]. One entry per framework cluster.
phase-b             symbolic-enumeration issue
phase-c             ad-hoc/config issue; also: expected entity unresolvable,
                    malformed expected-entities.json
phase-c-expansion   within-run expansion occurred (framework-based in step 4,
                    role-based in step 5) or hit its 200-candidate cap.
                    Telemetry, not a failure. Entries carry an optional
                    strategy_type field (framework | annotation | call_pattern |
                    name_pattern | path_pattern | combination).
classification      rule-matching issue
override-replay     overrides.json problem
other               escape hatch
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
