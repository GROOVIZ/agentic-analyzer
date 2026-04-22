# Role-based similar-entity discovery — design spec

**Date:** 2026-04-22
**Status:** design approved; ready for implementation plan
**Target version:** v0.4.0 (additive; no breaking changes)

## Goal

Extend the Phase C.2 expected-entities backstop with a new **role-expansion** mechanism that discovers entities which are "similar" to the ones in the dev-team oracle without requiring them to share a framework FQN. The existing step 4 (framework-expansion) stays as-is; this design adds step 5, driven by a new `role-inferencer` subagent that proposes auditable search strategies backed by per-criterion evidence.

The design targets the user-facing question *"find all entities similar to the ones I provided"* where similarity ranges from (A) same framework at call site — already covered — to (D) same semantic role — new work here, with tight guard-rails to prevent hallucinated expansions.

## Architecture

### Placement

Augment Phase C.2 (not replace, not separate command). New step 5 runs after step 4 (framework-expansion) and before Phase D classification. Both expansion mechanisms may fire in the same run; their candidates de-duplicate by `<id_field>`.

### Components

1. **`role-inferencer` subagent** — `agents/role-inferencer.md`. Dispatch-only. Takes oracle-hits + context; returns a structured `strategies[]` envelope with per-criterion evidence and self-assessed confidence.
2. **Orchestrator prose** — Phase C.2 step 5 in `_core/templates/prompts/discovery.md.tmpl`. Consumes the envelope, applies the tier-gate, executes queries, emits telemetry.
3. **Envelope schema** — `_core/schema/role-inferencer-envelope.schema.json`. Shared, non-templated (same pattern as `expected-entities.schema.json`). Validates the agent's output before execution.
4. **Coverage telemetry** — reuses the existing `phase-c-expansion` degradation stage with a new optional `strategy_type` field and a set of `role-expansion*` `reason:` prefixes.

### Tier-gate

| Condition | Path |
|---|---|
| Top strategy `confidence: "high"` | Autonomous: execute queries immediately |
| Top strategy `confidence ∈ {medium, low}`, interactive session | Interactive: print proposal, wait for Accept/Refine/Reject/Skip |
| Top strategy `confidence ∈ {medium, low}`, `AGENTIC_ANALYZER_NONINTERACTIVE=1` | Skip: emit degradation, proceed to Phase D |

Confidence definition (agent self-assesses in the envelope; orchestrator re-validates):

- **high**: every criterion `ground_count >= 2`; all queries reduce to concrete Serena/Grep calls; estimated hit count ≤ 200; exactly one strategy ranks at high confidence.
- **medium**: ≥1 criterion with `ground_count < 2`, OR estimated hit count is a wide range, OR ≥2 strategies have similar scores.
- **low**: agent explicitly flags uncertainty; queries contain natural-language steps; estimated hit count unknown.

### Cap

200 candidates per executed strategy (matches framework-expansion cap). Only the rank-1 strategy is eligible for autonomous execution per run. Lower-ranked strategies surface as `uncertainties[]` in the envelope; they are NOT auto-executed.

## The `role-inferencer` subagent

### Input brief

Supplied by the orchestrator:

- `oracle_hits[]` — for each oracle-resolved site:
  - `name`, `file`, `line_start`, `line_end`, `snippet` (30-line window),
  - `file_top` (first 50 lines — package + imports, read separately so imports don't get truncated),
  - `enclosing_class`, `enclosing_method`, `enclosing_method_signature` (from Serena `get_symbols_overview`),
  - `framework_identified` (the `library` from step 3.d; may be `"unknown"`).
- `analyzer_name`, `entity_name_human`, `language`, `frameworks[]`, `source_roots[]` — domain grounding.
- `frameworks_already_expanded[]` — libraries step 4 already surveyed; the agent MUST NOT propose strategies equivalent to expanding these.
- `autonomous_threshold`: `{ max_estimated_hits: 200, min_ground_count_per_criterion: 2 }`.

### Output envelope

Schema: `_core/schema/role-inferencer-envelope.schema.json` (to be created as part of implementation).

```json
{
  "strategies": [
    {
      "rank": 1,
      "strategy_type": "annotation | call_pattern | name_pattern | path_pattern | combination",
      "role_description": "<one-line human-readable role summary>",
      "criteria": [
        {
          "criterion": "<concrete, query-reducible statement>",
          "evidence": ["<oracle_hit_name @ file:line>", "..."],
          "ground_count": 4
        }
      ],
      "serena_queries": [
        { "tool": "find_symbol", "name_path": "...", "substring_matching": false },
        { "tool": "search_for_pattern", "regex": "..." }
      ],
      "grep_fallback_patterns": [ "..." ],
      "exclude_patterns": [ "test/", "**/*.test.*", "**/*.spec.*", "generated/", "build/", "target/", "dist/" ],
      "estimated_hit_count": "10-100",
      "confidence": "high | medium | low",
      "negative_examples": [
        "<identifier that would textually match but isn't the role described>"
      ]
    }
  ],
  "uncertainties": [
    { "topic": "...", "question": "...", "why": "..." }
  ]
}
```

### Hard rules the agent must follow

1. **Evidence-first.** Every criterion cites ≥1 oracle hit by name+location. A strategy's confidence is capped at `medium` when any criterion has `ground_count < 2`.
2. **Executable, not vibes.** `role_description` reduces to concrete tool queries. "Things that log messages a user could read" → reject. "Calls to `Logger.info/warn/error` with a format-string arg, excluding test/" → accept.
3. **Negative examples mandatory.** ≥3 things that would textually match the pattern but aren't the role. Each maps to an `exclude_pattern` or a narrowing of `serena_queries`.
4. **No fabrication.** Only use features observed in ≥1 oracle hit.
5. **Don't re-propose already-expanded frameworks.** Strategies that reduce to "find callers of X" where X ∈ `frameworks_already_expanded[]` are redundant — the agent must not emit them.
6. **Rank strategies** by (`sum(ground_count) * confidence_weight`) descending. Confidence weights: high=1.0, medium=0.5, low=0.2.
7. **Default exclusions** for `test/`, `**/*.test.*`, `**/*.spec.*`, `generated/`, `build/`, `target/`, `dist/` — applied unless an oracle hit explicitly lives in one of those paths (unusual, but possible).
8. **Self-assess confidence** against the orchestrator-supplied `autonomous_threshold`. Honesty: emit `medium` when unsure; never claim `high` to force autonomous execution.
9. **No tool execution.** The agent proposes queries; it does NOT run them. Orchestrator is the single execution point. Keeps envelope auditable and cost bounded.

## Orchestrator logic (Phase C.2 step 5 in `discovery.md.tmpl`)

### Step 5.1 — Build the input brief

Collect `oracle_hits[]` from step 3 (already in memory). For each hit:

- `Read` the file's first 50 lines (captured as `file_top`) — the 30-line snippet window may not include package declarations / imports.
- Call Serena `get_symbols_overview` on the file to fill `enclosing_class`, `enclosing_method`, `enclosing_method_signature`.

Build the brief per Section 2 shape.

### Step 5.2 — Dispatch `role-inferencer`

Use the `Task` tool with `subagent_type: role-inferencer`. Parse the returned envelope. Validate against `_core/schema/role-inferencer-envelope.schema.json`:

- On validation failure OR empty `strategies[]`: emit `phase-c-expansion` degradation
  - `reason: "role-inferencer returned no usable strategies"`,
  - `strategy_type: null`,
  and proceed to Phase D. Do NOT retry; do NOT abort the run.

### Step 5.3 — Tier-gate

Inspect the rank-1 strategy:

- `confidence == "high"` → autonomous path (step 5.4).
- `confidence ∈ {medium, low}` AND env `AGENTIC_ANALYZER_NONINTERACTIVE` is set (to `1`, `true`, or `yes`) → skip path (step 5.6 log only).
- Otherwise → interactive path (step 5.5).

### Step 5.4 — Execute (autonomous or post-accept)

For each `serena_queries[i]`:

- If Serena is available, dispatch the query via the specified tool (`find_symbol`, `search_for_pattern`, `find_referencing_symbols`, etc.).
- If Serena is unavailable, use the corresponding `grep_fallback_patterns[i]` via the `Grep` tool scoped to `source_roots[]`.

Apply `exclude_patterns` — drop any hit whose path matches a glob. De-duplicate against already-accumulated candidates by `<id_field>`. For each retained hit, construct a Phase C candidate using the Phase B candidate shape; tag `"phase": "C.2-role-expansion"`.

Stop at **200 new candidates**. If the 200th is reached before queries exhaust, halt and emit the cap-reached telemetry (step 5.6).

### Step 5.5 — Interactive approval

Print to the session:

```
[Phase C.2 step 5] Role-expansion proposal (confidence: <level>):

  Role: "<role_description>"
  Evidence:
    - <criterion 1> (grounded in <N> oracle hits: <hit names>)
    - <criterion 2> (grounded in <N> oracle hits: <hit names>)
  Queries:
    - <serena_query 1 serialized>
    - <serena_query 2 serialized>
  Excludes: <joined exclude_patterns>
  Estimated new candidates: <estimated_hit_count>

  Accept (A) / Refine (R) / Reject (J) / Skip (S)?
```

Handle the reply:

- `A` (or `accept` / `yes` / `ok`): proceed to step 5.4.
- `R` (or `refine`): accept free-form refinement input (e.g., "narrow to `src/core/`", "drop criterion 2", "change regex to …"). Apply inline to the in-memory strategy. Re-print the proposal and re-prompt.
- `J` / `S` (`reject` / `skip`): emit the rejected-telemetry degradation (step 5.6); skip step 5.4 for this strategy.

### Step 5.6 — Telemetry (unconditional)

For every path, emit exactly one `phase-c-expansion` degradation:

| Outcome | `reason:` |
|---|---|
| Auto-executed | `role-expansion: <role_description> (<N> candidates added)` |
| Interactive-accepted | `role-expansion (user-approved): <role_description> (<N> candidates added)` |
| Interactive-rejected | `role-expansion-rejected: <role_description> (user declined)` |
| Skipped (non-interactive + low conf) | `role-expansion-skipped: <role_description> (non-interactive mode, confidence <= medium)` |
| Cap-reached | `role-expansion-cap-reached: <role_description> (200 candidates, more available)` |
| Failed (no usable strategy) | `role-expansion: no strategy produced` |

Include `strategy_type: <type>` on every entry (new optional field on `coverage.degradations[]`). **Omit** the `library` field entirely for role-expansion entries — it's already optional in the existing coverage schema (`library` is a `string` when present, not required). Role-expansion is not library-based; omitting the field is semantically accurate and keeps the existing schema unchanged for that field. (Contrast: framework-expansion emits `library: "<FQN>"` per the existing contract.)

### Step 5.7 — Re-validate `candidates.json`

After any new candidates are appended in step 5.4, re-run:

```
node $SKILL_DIR/bin/validate.mjs $SKILL_DIR/schema/candidates.schema.json {{ANALYZER_NAME}}-analysis/output/runs/<run-id>/candidates.json
```

Defensive check. New candidates use the Phase B shape, so validation should pass — but catching a drift here prevents it from poisoning Phase D.

### Failure posture

Step 5 is a discovery *enhancement*, not a correctness gate. ANY failure inside step 5 emits a degradation and proceeds to Phase D. Never abort the run for role-expansion issues.

## Files to create / modify

### New

- `_core/schema/role-inferencer-envelope.schema.json` — validates the subagent's JSON envelope before execution.
- `agents/role-inferencer.md` — the subagent definition (MODE: dispatch only, hard rules, envelope shape, negative-examples requirement).

### Modified

- `_core/templates/prompts/discovery.md.tmpl` — Phase C.2 gains step 5 (the orchestrator logic above). The closing paragraph updates to note that role-expansion is a safety net alongside framework-expansion.
- `_core/templates/schema/coverage.schema.json.tmpl` — degradations entry schema gains optional `strategy_type` field (enum: `framework | annotation | call_pattern | name_pattern | path_pattern | combination`). No stage-enum changes — reuses `phase-c-expansion`.
- `_core/bin/scaffold-e2e.test.mjs` — add a test that the stamped coverage schema accepts a `phase-c-expansion` entry with `strategy_type: "call_pattern"`, and a test that validates a minimal `role-inferencer-envelope.schema.json` document.
- `agents/analyzer-reviewer.md` — extend the "Oracle / Phase C.2 backstop" checklist with role-expansion invariants (rank-1 only, no re-proposal of already-expanded frameworks, evidence-first confidence, cap at 200, strategy_type logged).
- `docs/PATTERN-CARD.md` — runtime phases row for Phase C.2 gains a mention of role-expansion alongside framework-expansion. Degradation table clarifies that `phase-c-expansion` covers both mechanisms now.
- `docs/superpowers/plans/2026-04-22-entity-properties.md` — no change; that plan is closed. A new plan file will drive this work.
- `commands/expected-entities.md` — no change: the oracle format is unchanged. Role-expansion reads the same `expected-entities.json`.

## Data flow

```
Oracle list (expected-entities.json)
      |
      v
Phase C.2 step 3: per-name search → oracle_hits[]
      |
      v
Phase C.2 step 4: framework-expansion (existing)
      |         → C.2-framework-expansion candidates
      |         → phase-a-gap + phase-c-expansion degradations
      v
Phase C.2 step 5 (NEW):
  5.1 build input brief with oracle_hits + Serena overviews + file_tops
  5.2 dispatch role-inferencer subagent
        → envelope: { strategies[], uncertainties[] }
  5.3 tier-gate on rank-1 strategy
        high ─────────→ 5.4 autonomous execute
        med/low + int ─→ 5.5 interactive approval ─→ 5.4 (if accepted)
        med/low + CI ──→ 5.6 skip + log
  5.4 execute queries via Serena (or Grep fallback)
        → C.2-role-expansion candidates (capped 200)
  5.6 emit phase-c-expansion degradation with strategy evidence
  5.7 re-validate candidates.json
      |
      v
Phase D: classification over all accumulated candidates
```

## Out of scope (deferred)

Captured here so they don't creep in during implementation:

- **Per-candidate LLM validation.** Each new C.2-role-expansion candidate could be re-checked by the agent ("does this fit the role?"). That's N extra LLM calls per run. Defer unless first real-world runs show systemic false positives.
- **Multi-strategy execution per run.** Only the rank-1 strategy is eligible. Lower-ranked strategies stay in `uncertainties[]`. A later `/refine-role-expansion` command could promote them.
- **Unified `discovery-strategist` refactor** (Approach B from brainstorming). Framework-expansion and role-expansion can be merged into one strategy-based mechanism. Ship role-expansion first; unify once real strategies are observed in the wild.
- **Name-pattern extraction as a standalone concept.** Subsumed here — if naming convention is the load-bearing signal, the agent picks `strategy_type: "name_pattern"` and queries become Grep regexes.
- **Strategy caching across runs.** Each run starts fresh. If the oracle hasn't changed, the inferred strategy would typically be the same — but caching adds staleness bugs without saving much.
- **User-overridable strategy file.** Authors may want to hand-write strategies. For now, `/expected-entities` is the only oracle-input surface; hand-written strategies are v0.5.0+ territory.

## Security considerations

- The agent proposes `serena_queries` and `grep_fallback_patterns` that the orchestrator executes. Queries and regexes are untrusted data from an LLM. Serena's tools sandbox their own inputs (they operate on the activated project's symbol index), so there's no file-system escape surface. Grep regexes could be crafted to be pathological (catastrophic backtracking), but the `Grep` tool uses ripgrep which is regex-safe against ReDoS. No code-execution surface.
- `exclude_patterns` are globs run against relative paths. They do not reach a shell; no injection surface.
- The role-inferencer does NOT have tool-execution access — it only returns JSON. No way for the agent to call external services, write files, or execute code. This is the same isolation as `rule-author` and `entity-list-ingestor`.

## Observability

Every role-expansion execution leaves a full audit trail:

- `coverage.degradations[]` entry with: `stage`, `reason`, `strategy_type`, `library: null`, plus the full `role_description`.
- `analysis.json` entries tagged `"phase": "C.2-role-expansion"` — grep-friendly.
- Optional (nice-to-have): persist the full envelope to `<analyzer>-analysis/output/runs/<run-id>/_role-inferencer-envelope.json` for deep post-mortem. Delete it alongside `_phaseA.json` / `_phaseB.json` at the end of the run (same lifecycle as existing intermediate phase files).

## Version target

v0.4.0. Additive feature, no breaking changes. Existing analyzers continue to work without the oracle (no envelope consumed) or without any low-confidence strategies (autonomous path only). The env var `AGENTIC_ANALYZER_NONINTERACTIVE` is new but defaults to unset (interactive behaviour preserved for existing users).
