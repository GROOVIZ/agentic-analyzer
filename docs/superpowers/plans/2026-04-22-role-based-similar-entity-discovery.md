# Role-based similar-entity discovery — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Phase C.2 step 5 (role-expansion) to the analyzer runtime so that given an oracle of N sample entities, the analyzer also discovers entities that play the same *role* — not only those using the same framework/library.

**Architecture:** Augment the existing Phase C.2 backstop with a new subagent (`role-inferencer`, dispatch-only) that proposes auditable search strategies with per-criterion evidence and self-assessed confidence. SKILL.md tier-gates: autonomous execution when confidence is high, interactive Accept/Refine/Reject/Skip when medium/low, skip path when `AGENTIC_ANALYZER_NONINTERACTIVE=1` (CI). Candidates tagged `"phase": "C.2-role-expansion"`; telemetry via the existing `phase-c-expansion` degradation stage with a new optional `strategy_type` field.

**Tech Stack:** Node 20+, Ajv 2020, `node --test`, markdown-driven templating via `_core/bin/stamp.mjs`.

**Scope boundary (deferred to post-0.4.0):**
- Per-candidate LLM validation pass.
- Multi-strategy execution per run (rank-1 only).
- Unified `discovery-strategist` refactor.
- Strategy caching across runs.
- User-overridable hand-written strategies.

---

## File structure

| File | Action | Responsibility |
|---|---|---|
| `plugins/agentic-analyzer/_core/schema/role-inferencer-envelope.schema.json` | Create | Shared (non-templated) JSON schema validating the role-inferencer subagent's output envelope before the orchestrator executes its queries. |
| `plugins/agentic-analyzer/agents/role-inferencer.md` | Create | The new dispatch-only subagent definition — input brief, output envelope, 9 hard rules from the spec. |
| `plugins/agentic-analyzer/_core/templates/prompts/discovery.md.tmpl` | Modify | Insert Phase C.2 step 5 (role-expansion orchestration) after existing step 4 (framework-expansion). Seven sub-steps. |
| `plugins/agentic-analyzer/_core/templates/schema/coverage.schema.json.tmpl` | Modify | Add optional `strategy_type` field to `degradations[]` items. Enum: `framework` / `annotation` / `call_pattern` / `name_pattern` / `path_pattern` / `combination`. |
| `plugins/agentic-analyzer/_core/bin/scaffold-e2e.test.mjs` | Modify | Add 6 tests: envelope schema accepts a valid doc, rejects missing strategies[], rejects missing criterion.evidence, rejects unknown strategy_type, rejects `<3` negative_examples, stamped coverage schema accepts `strategy_type: "call_pattern"` on a phase-c-expansion entry. |
| `plugins/agentic-analyzer/agents/analyzer-reviewer.md` | Modify | Extend the Oracle / Phase C.2 backstop section with role-expansion invariants. |
| `plugins/agentic-analyzer/docs/PATTERN-CARD.md` | Modify | Phase C.2 row in the runtime phases block mentions role-expansion alongside framework-expansion. Degradation stages block clarifies `phase-c-expansion` now covers both flavours. |
| `CHANGELOG.md` | Modify | Populate `[Unreleased]` with v0.4.0 Added/Changed entries describing the role-expansion feature. |

---

## Prerequisites (read first)

1. Run the full suite to establish a green baseline:
   ```
   cd plugins/agentic-analyzer/_core && npm test
   ```
   Expected: `tests 133, pass 133, fail 0`.

2. Read these end-to-end once:
   - `docs/superpowers/specs/2026-04-22-role-based-similar-entity-discovery-design.md` — the design spec this plan implements.
   - `plugins/agentic-analyzer/_core/templates/prompts/discovery.md.tmpl` Phase C.2 section (lines ~115–243) — where step 5 will slot in.
   - `plugins/agentic-analyzer/_core/schema/expected-entities.schema.json` — the existing shared (non-templated) schema, which this plan's envelope schema mirrors in structure.
   - `plugins/agentic-analyzer/agents/entity-list-ingestor.md` — the existing dispatch-only subagent; the new `role-inferencer` follows the same frontmatter + envelope pattern.

3. Confirm: the feature is **additive**. No existing behaviour changes. Framework-expansion (step 4) stays as-is; step 5 is new. Existing analyzers produce identical output when no oracle file exists.

---

## Task 1: Create the role-inferencer envelope schema (TDD)

**Files:**
- Create: `plugins/agentic-analyzer/_core/schema/role-inferencer-envelope.schema.json`
- Test: `plugins/agentic-analyzer/_core/bin/scaffold-e2e.test.mjs`

### Step 1.1 — Write the failing tests

Add these five tests to `scaffold-e2e.test.mjs`, placed immediately **after** the existing test `e2e: stamped analysis.schema.json rejects non-primitive property values` and **before** the existing test `e2e: stamped coverage.schema.json accepts phase-c-expansion in degradations[].stage`. Each test is a standalone `test(...)` block.

```js
test("e2e: role-inferencer envelope schema accepts a valid envelope with all required fields", async () => {
  const { default: Ajv2020 } = await import("ajv/dist/2020.js");
  const { default: addFormats } = await import("ajv-formats");
  const schemaPath = join(here, "..", "schema", "role-inferencer-envelope.schema.json");
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  const doc = {
    strategies: [{
      rank: 1,
      strategy_type: "call_pattern",
      role_description: "calls to Logger.info/warn/error with a format-string arg",
      criteria: [{
        criterion: "receiver is of type org.slf4j.Logger",
        evidence: ["userSignupLogger @ Foo.java:42", "orderAuditLogger @ Bar.java:17"],
        ground_count: 2
      }],
      serena_queries: [
        { tool: "find_symbol", name_path: "Logger/info", substring_matching: false }
      ],
      grep_fallback_patterns: ["\\blog\\.(info|warn|error)\\s*\\("],
      exclude_patterns: ["test/", "**/*.test.*"],
      estimated_hit_count: "10-100",
      confidence: "high",
      negative_examples: [
        "System.out.println(...) — not a Logger call",
        "log.debug(...) — excluded by role (no oracle hit uses debug)",
        "printf(...) — stdlib, not Logger"
      ]
    }],
    uncertainties: []
  };
  assert.ok(validate(doc), JSON.stringify(validate.errors, null, 2));
});

test("e2e: role-inferencer envelope rejects envelope missing strategies[]", async () => {
  const { default: Ajv2020 } = await import("ajv/dist/2020.js");
  const { default: addFormats } = await import("ajv-formats");
  const schemaPath = join(here, "..", "schema", "role-inferencer-envelope.schema.json");
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  assert.ok(!validate({}), "envelope without strategies[] should be rejected");
});

test("e2e: role-inferencer envelope rejects a criterion without evidence[]", async () => {
  const { default: Ajv2020 } = await import("ajv/dist/2020.js");
  const { default: addFormats } = await import("ajv-formats");
  const schemaPath = join(here, "..", "schema", "role-inferencer-envelope.schema.json");
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  const doc = {
    strategies: [{
      rank: 1,
      strategy_type: "call_pattern",
      role_description: "x",
      criteria: [{ criterion: "c", ground_count: 1 }], // missing evidence[]
      serena_queries: [],
      grep_fallback_patterns: [],
      exclude_patterns: [],
      estimated_hit_count: "0-10",
      confidence: "low",
      negative_examples: ["a", "b", "c"]
    }]
  };
  assert.ok(!validate(doc), "criterion without evidence[] should be rejected");
});

test("e2e: role-inferencer envelope rejects an unknown strategy_type", async () => {
  const { default: Ajv2020 } = await import("ajv/dist/2020.js");
  const { default: addFormats } = await import("ajv-formats");
  const schemaPath = join(here, "..", "schema", "role-inferencer-envelope.schema.json");
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  const doc = {
    strategies: [{
      rank: 1,
      strategy_type: "vibes_based",
      role_description: "x",
      criteria: [{ criterion: "c", evidence: ["a"], ground_count: 1 }],
      serena_queries: [],
      grep_fallback_patterns: [],
      exclude_patterns: [],
      estimated_hit_count: "0-10",
      confidence: "low",
      negative_examples: ["a", "b", "c"]
    }]
  };
  assert.ok(!validate(doc), "unknown strategy_type should be rejected");
});

test("e2e: role-inferencer envelope rejects fewer than 3 negative_examples", async () => {
  const { default: Ajv2020 } = await import("ajv/dist/2020.js");
  const { default: addFormats } = await import("ajv-formats");
  const schemaPath = join(here, "..", "schema", "role-inferencer-envelope.schema.json");
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  const doc = {
    strategies: [{
      rank: 1,
      strategy_type: "call_pattern",
      role_description: "x",
      criteria: [{ criterion: "c", evidence: ["a"], ground_count: 1 }],
      serena_queries: [],
      grep_fallback_patterns: [],
      exclude_patterns: [],
      estimated_hit_count: "0-10",
      confidence: "low",
      negative_examples: ["only", "two"] // only 2 items — spec mandates >=3
    }]
  };
  assert.ok(!validate(doc), "fewer than 3 negative_examples should be rejected");
});
```

### Step 1.2 — Run tests to verify RED

```
cd plugins/agentic-analyzer/_core && node --test bin/scaffold-e2e.test.mjs 2>&1 | grep -E "(pass |fail |tests )"
```

Expected: all 5 new tests fail with schema-read errors (file doesn't exist yet). Pre-existing tests still pass.

### Step 1.3 — Create the envelope schema

Create `plugins/agentic-analyzer/_core/schema/role-inferencer-envelope.schema.json` with this exact content:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://agentic-analyzer/schemas/role-inferencer-envelope.schema.json",
  "title": "Role-inferencer subagent output envelope",
  "description": "The strict shape the role-inferencer subagent must return. Validated by the Phase C.2 step 5 orchestrator before any queries are executed. Queries that don't match this shape are treated as ingestor failure and replaced with a phase-c-expansion degradation (reason: \"role-inferencer returned no usable strategies\").",
  "type": "object",
  "required": ["strategies"],
  "additionalProperties": false,
  "properties": {
    "strategies": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "rank",
          "strategy_type",
          "role_description",
          "criteria",
          "serena_queries",
          "grep_fallback_patterns",
          "exclude_patterns",
          "estimated_hit_count",
          "confidence",
          "negative_examples"
        ],
        "additionalProperties": false,
        "properties": {
          "rank": { "type": "integer", "minimum": 1 },
          "strategy_type": {
            "enum": [
              "annotation",
              "call_pattern",
              "name_pattern",
              "path_pattern",
              "combination"
            ]
          },
          "role_description": { "type": "string", "minLength": 1 },
          "criteria": {
            "type": "array",
            "minItems": 1,
            "items": {
              "type": "object",
              "required": ["criterion", "evidence", "ground_count"],
              "additionalProperties": false,
              "properties": {
                "criterion": { "type": "string", "minLength": 1 },
                "evidence": {
                  "type": "array",
                  "minItems": 1,
                  "items": { "type": "string", "minLength": 1 }
                },
                "ground_count": { "type": "integer", "minimum": 1 }
              }
            }
          },
          "serena_queries": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["tool"],
              "additionalProperties": true,
              "properties": {
                "tool": {
                  "enum": [
                    "find_symbol",
                    "find_referencing_symbols",
                    "search_for_pattern"
                  ]
                }
              }
            }
          },
          "grep_fallback_patterns": {
            "type": "array",
            "items": { "type": "string", "minLength": 1 }
          },
          "exclude_patterns": {
            "type": "array",
            "items": { "type": "string", "minLength": 1 }
          },
          "estimated_hit_count": { "type": "string", "minLength": 1 },
          "confidence": { "enum": ["high", "medium", "low"] },
          "negative_examples": {
            "type": "array",
            "minItems": 3,
            "items": { "type": "string", "minLength": 1 }
          }
        }
      }
    },
    "uncertainties": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["topic", "question", "why"],
        "additionalProperties": false,
        "properties": {
          "topic": { "type": "string" },
          "question": { "type": "string" },
          "why": { "type": "string" }
        }
      }
    }
  }
}
```

### Step 1.4 — Run tests to verify GREEN

```
cd plugins/agentic-analyzer/_core && npm test 2>&1 | tail -5
```

Expected: `tests 138, pass 138, fail 0` (133 prior + 5 new).

### Step 1.5 — Commit

```
cd plugins/agentic-analyzer && git add plugins/agentic-analyzer/_core/schema/role-inferencer-envelope.schema.json plugins/agentic-analyzer/_core/bin/scaffold-e2e.test.mjs && git commit -m "feat(schema): role-inferencer output envelope schema

Task 1 of docs/superpowers/plans/2026-04-22-role-based-similar-entity-discovery.md.
Shared (non-templated) JSON schema validating the role-inferencer
subagent's output before the Phase C.2 step 5 orchestrator executes
any of its queries. Enforces: rank / strategy_type / role_description
non-empty, >=1 criterion with >=1 evidence item, known strategy_type
enum, >=3 negative_examples, confidence in {high, medium, low}.
Invalid envelopes become a phase-c-expansion degradation
('role-inferencer returned no usable strategies') rather than
execution attempts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Extend coverage.schema.json.tmpl with optional strategy_type field (TDD)

**Files:**
- Modify: `plugins/agentic-analyzer/_core/templates/schema/coverage.schema.json.tmpl`
- Test: `plugins/agentic-analyzer/_core/bin/scaffold-e2e.test.mjs`

### Step 2.1 — Write the failing test

Add this test to `scaffold-e2e.test.mjs` immediately **after** the existing test `e2e: stamped coverage.schema.json accepts phase-c-expansion in degradations[].stage`:

```js
test("e2e: stamped coverage.schema.json accepts phase-c-expansion with strategy_type field", async () => {
  const { default: Ajv2020 } = await import("ajv/dist/2020.js");
  const { default: addFormats } = await import("ajv-formats");
  const { dir, out, r } = scaffold(LOGGING_CONFIG);
  try {
    assert.equal(r.status, 0);
    const schema = JSON.parse(readFileSync(join(out, "schema/coverage.schema.json"), "utf8"));
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(schema);

    const doc = {
      serena_available: true,
      context7_available: true,
      frameworks_surveyed: [],
      files_visited: 0,
      symbols_resolved: 0,
      unresolved_symbols: [],
      degradations: [{
        stage: "phase-c-expansion",
        reason: "role-expansion (user-approved): calls to Logger.info/warn (12 candidates added)",
        strategy_type: "call_pattern"
      }]
    };
    assert.ok(validate(doc), JSON.stringify(validate.errors, null, 2));

    // Bad strategy_type is rejected.
    const badDoc = {
      ...doc,
      degradations: [{ ...doc.degradations[0], strategy_type: "vibes" }]
    };
    assert.ok(!validate(badDoc), "unknown strategy_type value should be rejected");
  } finally { cleanup(dir); }
});
```

### Step 2.2 — Verify RED

```
cd plugins/agentic-analyzer/_core && node --test bin/scaffold-e2e.test.mjs 2>&1 | grep -E "(pass |fail |tests )"
```

Expected: 1 new failure (the positive-case assert; the stamped schema doesn't yet permit `strategy_type`, so Ajv rejects the field as unknown under `additionalProperties: true`... actually wait). Let me re-check: the existing schema uses `additionalProperties: true` on degradation items. So the schema technically accepts any extra field. The test's NEGATIVE case (bad value) would pass trivially (schema allows anything). The test as written won't fail in RED if we rely on `additionalProperties`. We need the schema to constrain `strategy_type` to an enum — that's the real addition.

Re-reading the spec: the field is optional with an enum. So the change to the template is: add `strategy_type` to `properties` with an enum constraint. `additionalProperties: true` remains for other extra fields. The positive-case doc above validates in both old (via additionalProperties) and new schema. But the negative-case assert (`strategy_type: "vibes"`) is the one that only fails after the change.

Therefore the test's effective RED signal is the negative-case assert (`assert.ok(!validate(badDoc), ...)`). Before the change, the schema allows anything via additionalProperties, so `strategy_type: "vibes"` passes — the `!validate` assert fires.

The test file name stays the same; only the failing behaviour is the negative case. Confirm 1 failing test.

### Step 2.3 — Modify coverage.schema.json.tmpl

In `plugins/agentic-analyzer/_core/templates/schema/coverage.schema.json.tmpl`, find the `degradations` items definition. Current state (approx lines 40–53):

**Before:**
```json
"degradations": {
  "type": "array",
  "items": {
    "type": "object",
    "additionalProperties": true,
    "required": ["stage", "reason"],
    "properties": {
      "stage":  { "enum": ["context7", "serena", "phase-a", "phase-a-gap", "phase-b", "phase-c", "phase-c-expansion", "classification", "override-replay", "other"] },
      "reason": { "type": "string" },
      "library":{ "type": "string" }
    }
  }
}
```

**After:**
```json
"degradations": {
  "type": "array",
  "items": {
    "type": "object",
    "additionalProperties": true,
    "required": ["stage", "reason"],
    "properties": {
      "stage":  { "enum": ["context7", "serena", "phase-a", "phase-a-gap", "phase-b", "phase-c", "phase-c-expansion", "classification", "override-replay", "other"] },
      "reason": { "type": "string" },
      "library":{ "type": "string" },
      "strategy_type": { "enum": ["framework", "annotation", "call_pattern", "name_pattern", "path_pattern", "combination"] }
    }
  }
}
```

`strategy_type` is NOT added to `required` — the field remains optional. `additionalProperties: true` is preserved (other fields like `names[]` from Phase C.2 clustering still round-trip).

### Step 2.4 — Verify GREEN

```
cd plugins/agentic-analyzer/_core && npm test 2>&1 | tail -5
```

Expected: `tests 139, pass 139, fail 0`.

### Step 2.5 — Commit

```
cd plugins/agentic-analyzer && git add plugins/agentic-analyzer/_core/templates/schema/coverage.schema.json.tmpl plugins/agentic-analyzer/_core/bin/scaffold-e2e.test.mjs && git commit -m "feat(schema): optional strategy_type on coverage.degradations[]

Task 2 of docs/superpowers/plans/2026-04-22-role-based-similar-entity-discovery.md.
Adds optional \`strategy_type\` to each degradations[] item, enum:
framework / annotation / call_pattern / name_pattern / path_pattern /
combination. framework-expansion and role-expansion can both populate
it; consumers filter degradations by strategy flavour without parsing
the \`reason\` prose.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Create the role-inferencer subagent

**Files:**
- Create: `plugins/agentic-analyzer/agents/role-inferencer.md`

No code test; prose. The existing scaffold-e2e placeholder-integrity test covers it implicitly (no stamped placeholders in this file since it's not templated).

### Step 3.1 — Create the agent file

Create `plugins/agentic-analyzer/agents/role-inferencer.md` with this exact content:

```
---
name: role-inferencer
description: Infers a "role" pattern from N oracle-resolved sample sites and returns one or more search strategies the orchestrator can execute against Serena/Grep. Use when /analyze-<name>'s Phase C.2 step 5 needs to expand discovery beyond same-framework similarity — e.g., to find every call to a method named info/warn/error with a format-string arg, regardless of which logger library is in use. Dispatch-only; never runs queries itself.
model: sonnet
---

You are the role-inferencer specialist. Your job is to take N oracle-
resolved sample sites, study what they have in common, and return a
structured JSON envelope of auditable search strategies that the
orchestrator (Phase C.2 step 5 of SKILL.md) will execute to discover
similar entities.

You do NOT run queries. You propose them. The orchestrator is the
single execution point — that keeps your output a reviewable
artifact even when the orchestrator decides to pause for human
approval before executing.

## Dispatch mode (only)

You are always invoked via `MODE: dispatch` with a structured brief.
There is no interactive mode. If the dispatching prompt does not
start with `MODE: dispatch`, return:

    { "strategies": [], "uncertainties": [{ "topic": "invocation", "question": "missing MODE: dispatch marker", "why": "role-inferencer only supports dispatch mode" }] }

### Input brief shape

The dispatching prompt supplies these keys:

- `oracle_hits[]` — array of objects, one per oracle-resolved site:
  - `name` — the oracle entry that resolved to this site
  - `file` — repo-relative path
  - `line_start`, `line_end` — site location
  - `snippet` — the 30-line window around the site
  - `file_top` — the first 50 lines of the file (package + imports),
    captured separately so imports aren't clipped by the snippet window
  - `enclosing_class`, `enclosing_method`, `enclosing_method_signature` —
    from Serena `get_symbols_overview`
  - `framework_identified` — the `library` inferred in Phase C.2 step 3.d;
    may be the string `"unknown"`
- `analyzer_name` — the domain (e.g., `"logging"`)
- `entity_name_human` — the entity phrase (e.g., `"Log call-site"`)
- `language` — e.g., `"java"`
- `frameworks[]` — libraries declared in the analyzer config
- `source_roots[]` — scan scope
- `frameworks_already_expanded[]` — libraries Phase C.2 step 4 has
  already surveyed. Strategies that reduce to "find callers of X"
  for any X in this list are redundant and MUST NOT be emitted.
- `autonomous_threshold` — `{ max_estimated_hits: <int>, min_ground_count_per_criterion: <int> }`
  used to calibrate your own `confidence` self-assessment.

### Output envelope

Return ONLY this JSON object. No surrounding prose, no markdown fence.
Schema at `_core/schema/role-inferencer-envelope.schema.json`.

    {
      "strategies": [
        {
          "rank": 1,
          "strategy_type": "annotation | call_pattern | name_pattern | path_pattern | combination",
          "role_description": "<one-line human-readable role summary>",
          "criteria": [
            {
              "criterion": "<concrete, query-reducible statement>",
              "evidence": ["<oracle_hit.name @ file:line>", "..."],
              "ground_count": <int >= 1>
            }
          ],
          "serena_queries": [
            { "tool": "find_symbol", "name_path": "...", "substring_matching": false },
            { "tool": "search_for_pattern", "regex": "..." }
          ],
          "grep_fallback_patterns": [ "..." ],
          "exclude_patterns": ["test/", "**/*.test.*", "**/*.spec.*", "generated/", "build/", "target/", "dist/"],
          "estimated_hit_count": "10-100",
          "confidence": "high | medium | low",
          "negative_examples": [
            "<identifier that would textually match the pattern but is NOT the role described>",
            "<second>",
            "<third>"
          ]
        }
      ],
      "uncertainties": [
        { "topic": "...", "question": "...", "why": "..." }
      ]
    }

## Hard rules

1. **Evidence-first.** Every criterion must cite >=1 oracle hit by
   name + location in its `evidence[]` array. A strategy's
   `confidence` is capped at `medium` when ANY criterion has
   `ground_count < 2`. Single-grounded criteria are permitted (they
   may be genuine low-confidence signals) but they downgrade the
   strategy, they don't upgrade it.

2. **Executable, not vibes.** `role_description` must reduce to
   concrete tool queries. Reject: "things that log messages a user
   could read." Accept: "calls to a method named `info`/`warn`/`error`
   on a receiver typed `org.slf4j.Logger` or a local logger field."
   If you cannot express a criterion as a concrete query, it belongs
   in `uncertainties[]` — not in `criteria[]`.

3. **Negative examples mandatory.** Each strategy MUST include >=3
   `negative_examples`: things that would textually match the
   proposed pattern but clearly aren't the role described. Each
   negative example should correspond to either an `exclude_pattern`
   or a narrowing of the `serena_queries` that rules it out.

4. **No fabrication.** Only use features observed in >=1 oracle hit.
   Do not invent plausible-sounding criteria because they "would
   make sense" — the author can always refine the oracle if the
   current sample is incomplete.

5. **Don't re-propose already-expanded frameworks.** If
   `frameworks_already_expanded[]` contains
   `com.company.util.QuietLog`, do NOT emit a strategy whose
   queries reduce to "find all callers of QuietLog" — Phase C.2
   step 4 handled it. Emit a different strategy, or leave
   `strategies[]` empty and explain in `uncertainties[]`.

6. **Rank strategies** by `(sum(ground_count) * confidence_weight)`
   descending. Confidence weights: high=1.0, medium=0.5, low=0.2.
   Only the rank-1 strategy is eligible for autonomous execution by
   the orchestrator; lower-ranked strategies become
   `uncertainties[]` entries the author can promote manually.

7. **Default exclusions** for test / generated / build dirs are
   ALWAYS applied unless an oracle hit explicitly lives in one of
   those paths (unusual, but possible — e.g., the analyzer may be
   inventorying test-logger call-sites). Defaults:
   `["test/", "**/*.test.*", "**/*.spec.*", "generated/", "build/", "target/", "dist/"]`.

8. **Self-assess confidence** against the orchestrator-supplied
   `autonomous_threshold`:
   - `high`: every criterion `ground_count >= min_ground_count_per_criterion` AND
     `estimated_hit_count` upper bound `<= max_estimated_hits` AND
     queries reduce to concrete tool calls (no natural-language steps) AND
     exactly one strategy in `strategies[]` reaches this bar.
   - `medium`: >=1 criterion below threshold, OR `estimated_hit_count`
     is a very wide range (e.g., "50-1000"), OR >=2 strategies have
     similar `(sum(ground_count) * confidence_weight)` scores.
   - `low`: you had to guess; your queries contain approximations;
     you are genuinely uncertain whether the strategy reflects the
     oracle's intent.

   Be honest. Claiming `high` when you aren't will trigger
   autonomous execution and pollute the author's analysis with
   false positives.

9. **No tool execution.** Do NOT use Serena, Context7, Grep, Read,
   or any other tool while producing this envelope. Your input
   brief contains everything you need. Proposing queries is your
   output; executing them is not your concern.

## Examples of good strategies

**Annotation-based.** All oracle hits are methods annotated with
`@Logged`. Criteria: "method has @Logged annotation". Queries:
`{ tool: "search_for_pattern", regex: "@Logged\\s+\\w" }`. Negative
examples: `@Log`, `@Loggable`, `@Auditable` (distinct annotations
with different semantics).

**Call-pattern.** All oracle hits call `Logger.info`/`warn`/`error`.
Criteria: "call to a method named info/warn/error on a Logger-typed
receiver". Queries: Serena `find_symbol` with name_path
`Logger/info`, `Logger/warn`, `Logger/error`, substring_matching
false. Negative examples: `debug`, `trace`, `fatal` (levels the
oracle doesn't include).

**Name-pattern.** All oracle hits are fields whose identifier ends
in `Logger`. Criteria: "field declaration with identifier matching
`*Logger`". Queries: `search_for_pattern` with regex
`\\b\\w+Logger\\b`. Negative examples: `LoggerFactory` (factory, not
a log call-site), `Logger.class` (reflection, not a call-site),
`TestLogger` (inside test/).

**Path-pattern.** All oracle hits live under `src/audit/`. Criteria:
"file path matches `src/audit/**`". Queries: Grep scoped to that
directory for the domain-specific marker. Negative examples: files
under `src/audit/internal/` if internal code is deliberately
excluded from inventory.

**Combination.** Oracle hits share BOTH a call-pattern AND a
package constraint. Criteria: both bullets. Queries: intersection
via two separate queries + orchestrator's deduplication. Negative
examples: same call-pattern outside the package.

## Uncertainty honesty

Empty `uncertainties[]` is a strong claim: "I understood the
oracle's intent unambiguously." Emit an uncertainty whenever:

- Some criterion could be interpreted two ways and you picked one.
- The oracle is small (fewer than 3 hits) and the pattern is
  fragile.
- One oracle hit doesn't fit any clean pattern you can extract from
  the others (outlier).
- You deliberately downgraded the strategy's confidence despite
  being somewhat confident — say what tipped you toward caution.

## Hard rules (reiteration)

- Return raw JSON, nothing else. No markdown fence, no commentary.
- No fabrication.
- Evidence is mandatory per criterion.
- Negative examples are mandatory (>=3).
- No re-proposing already-expanded frameworks.
- Self-assess confidence honestly.
```

### Step 3.2 — Verify tests still pass

```
cd plugins/agentic-analyzer/_core && npm test 2>&1 | tail -5
```

Expected: `tests 139, pass 139, fail 0`. No new tests; existing suite still green.

### Step 3.3 — Commit

```
cd plugins/agentic-analyzer && git add plugins/agentic-analyzer/agents/role-inferencer.md && git commit -m "feat(agents): add role-inferencer subagent (dispatch-only)

Task 3 of docs/superpowers/plans/2026-04-22-role-based-similar-entity-discovery.md.
MODE: dispatch only. Consumes oracle-hits + file context + existing
framework expansion results; returns a strategies[] envelope
validated against _core/schema/role-inferencer-envelope.schema.json.
Enforces evidence-first criteria, executable-not-vibes role
descriptions, mandatory negative examples (>=3), no re-proposing
already-expanded frameworks, honest self-assessed confidence. Agent
has no tool access — proposal-only keeps the envelope auditable and
cost bounded.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Insert Phase C.2 step 5 into discovery.md.tmpl

**Files:**
- Modify: `plugins/agentic-analyzer/_core/templates/prompts/discovery.md.tmpl`

No new tests; the scaffold-e2e placeholder-integrity test (`e2e: discovery prompt uses the scaffolded id field`) covers placeholder resolution of any tokens referenced in the new content.

### Step 4.1 — Read current Phase C.2 state

Open `plugins/agentic-analyzer/_core/templates/prompts/discovery.md.tmpl` and locate step 5 of Phase C.2 (the `If at least one expected entity was resolved via the backstop` summary note, around lines 234–242). Step 5 here is a summary paragraph, NOT the step numbering we'll use. We'll insert a new section BEFORE that summary paragraph.

### Step 4.2 — Insert step 5 (role-expansion)

In `discovery.md.tmpl`, find the line that begins `5. If at least one expected entity was resolved via the backstop`. Replace it with a NEW step 5 (role-expansion) followed by a renumbered step 6 (the old summary).

**Before:**
```
5. If at least one expected entity was resolved via the backstop, include
   a short note in the run's summary so the author knows Phase A/B missed
   them. The `phase-a-gap` degradations specifically are the most
   actionable signal: each one points at a framework the author can
   add to `frameworks[]` to close the gap at its source for future runs.
```

**After:**
```
5. **Role-based expansion.** After step 4 (framework-expansion), dispatch
   the `role-inferencer` subagent to propose search strategies for
   entities that share the oracle's *role* rather than its framework.
   This sub-phase runs whenever `oracle_hits[]` from step 3 is non-empty,
   regardless of whether step 4 fired. It is additive: candidates from
   step 5 de-duplicate against step 4's output by `{{ID_FIELD}}`.

   5.1 **Build the input brief.** For each hit in `oracle_hits[]`:
       - `Read` lines 1–50 of `source.file` (captured as `file_top`)
         so imports aren't clipped by the 30-line snippet window.
       - Call `mcp__plugin_serena_serena__get_symbols_overview` on the
         file to fill `enclosing_class`, `enclosing_method`, and
         `enclosing_method_signature`.
       Build the brief with: oracle_hits[] (enriched as above),
       `analyzer_name: "{{ANALYZER_NAME}}"`,
       `entity_name_human: "{{ENTITY_NAME_HUMAN}}"`,
       `language: "{{LANGUAGE}}"`,
       `frameworks: [{{FRAMEWORK_LIST}}]`,
       `source_roots: [{{SOURCE_ROOTS}}]`,
       `frameworks_already_expanded: <libraries step 4 just surveyed>`,
       `autonomous_threshold: { max_estimated_hits: 200, min_ground_count_per_criterion: 2 }`.

   5.2 **Dispatch `role-inferencer`.** Use the `Task` tool with
       `subagent_type: role-inferencer` and the brief above. Validate
       the returned envelope against
       `{{ANALYZER_NAME}}-analysis/../_core/schema/role-inferencer-envelope.schema.json`
       (resolve the plugin's core dir via `$CLAUDE_PLUGIN_ROOT`). On
       validation failure OR empty `strategies[]`, append a
       `coverage.degradations[]` entry:
       ```json
       {
         "stage": "phase-c-expansion",
         "reason": "role-inferencer returned no usable strategies"
       }
       ```
       and proceed to step 6. Do NOT retry; do NOT abort the run.

   5.3 **Tier-gate on the rank-1 strategy.** Inspect `strategies[0].confidence`:
       - `"high"` → autonomous path (step 5.4 directly).
       - `"medium"` or `"low"`, AND the env var
         `AGENTIC_ANALYZER_NONINTERACTIVE` is set to `1` / `true` / `yes` →
         skip path (step 5.6 telemetry only; do NOT execute queries).
       - Otherwise → interactive path (step 5.5).

   5.4 **Execute the strategy (autonomous, or after interactive
       acceptance).** For each `serena_queries[i]`:
       - If Serena is available, dispatch via the specified tool
         (`mcp__plugin_serena_serena__find_symbol`,
         `mcp__plugin_serena_serena__search_for_pattern`,
         `mcp__plugin_serena_serena__find_referencing_symbols`).
       - If Serena is unavailable, use `grep_fallback_patterns[i]` via
         the `Grep` tool scoped to `source_roots`.
       Apply `exclude_patterns` — drop any hit whose path matches a
       glob. De-duplicate against already-accumulated candidates by
       `{{ID_FIELD}}`. For each retained hit, construct a Phase C
       candidate using the Phase B candidate shape and tag
       `"phase": "C.2-role-expansion"`.

       **Cap: 200 new candidates.** If the 200th is reached before
       queries exhaust, halt and emit the cap-reached telemetry
       (step 5.6).

   5.5 **Interactive approval** (when tier-gate routes here). Print
       to the session:
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

       Handle the user's reply:
       - `A` / `accept` / `yes` / `ok` → go to step 5.4.
       - `R` / `refine` → accept free-form refinement input (e.g.,
         "narrow to `src/core/`", "drop criterion 2", "change regex
         to X"). Apply inline to the in-memory strategy. Re-print
         the proposal and re-prompt.
       - `J` / `S` / `reject` / `skip` → emit rejected-telemetry
         (step 5.6); skip step 5.4.
       - Unrecognized reply → re-prompt with
         `[Phase C.2 step 5] Reply ambiguous — please choose A/R/J/S.`

   5.6 **Telemetry (unconditional).** Emit exactly one
       `coverage.degradations[]` entry for whichever path ran:

       | Outcome | `reason:` prefix |
       |---|---|
       | Auto-executed | `role-expansion: <role_description> (<N> candidates added)` |
       | Interactive-accepted | `role-expansion (user-approved): <role_description> (<N> candidates added)` |
       | Interactive-rejected | `role-expansion-rejected: <role_description> (user declined)` |
       | Skipped (non-interactive + low conf) | `role-expansion-skipped: <role_description> (non-interactive mode, confidence <= medium)` |
       | Cap-reached | `role-expansion-cap-reached: <role_description> (200 candidates, more available)` |
       | No strategy produced | `role-expansion: no strategy produced` (step 5.2 fallback) |

       Include `strategy_type: <strategies[0].strategy_type>` on the
       entry. Omit `library` (role-expansion is not library-based).

   5.7 **Re-validate `candidates.json`.** After any new candidates
       were appended in step 5.4, re-run:
       ```
       node $SKILL_DIR/bin/validate.mjs $SKILL_DIR/schema/candidates.schema.json {{ANALYZER_NAME}}-analysis/output/runs/<run-id>/candidates.json
       ```
       Defensive. New candidates use the Phase B shape; this should
       never fail, but catching a drift here prevents it from
       poisoning Phase D.

   **Failure posture.** Step 5 is a discovery *enhancement*, not a
   correctness gate. ANY failure inside step 5 emits a
   `phase-c-expansion` degradation and continues to step 6. Never
   abort the run for role-expansion issues.

6. If at least one expected entity was resolved via the backstop, include
   a short note in the run's summary so the author knows Phase A/B missed
   them. The `phase-a-gap` degradations specifically are the most
   actionable signal: each one points at a framework the author can
   add to `frameworks[]` to close the gap at its source for future runs.
   Role-expansion outcomes (step 5) land as `phase-c-expansion`
   degradations — treat a high count of those as a signal the
   oracle's samples are doing a lot of work and the ruleset may need
   additional rules rather than relying on backstop inference.
```

### Step 4.3 — Verify placeholder integrity

```
cd plugins/agentic-analyzer/_core && npm test 2>&1 | tail -5
```

Expected: `tests 139, pass 139, fail 0`. The existing `e2e: discovery prompt uses the scaffolded id field` test walks the stamped discovery.md and asserts no unresolved `{{...}}` tokens — the new content uses only `{{ID_FIELD}}`, `{{ANALYZER_NAME}}`, `{{ENTITY_NAME_HUMAN}}`, `{{LANGUAGE}}`, `{{FRAMEWORK_LIST}}`, `{{SOURCE_ROOTS}}`, all already substituted by `stamp.mjs`.

### Step 4.4 — Stamp spot-check

```
cd plugins/agentic-analyzer/_core && node -e "
const { spawnSync } = require('child_process');
const { mkdtempSync, writeFileSync, readFileSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');
const dir = mkdtempSync(join(tmpdir(), 'plan-step5-'));
const cfg = join(dir, 'config.json');
writeFileSync(cfg, JSON.stringify({
  analyzer_name: 'logging', entity_name_human: 'Log call-site', entity_key: 'entries',
  id_field: 'call_site_id', target_const: 'pii-regulated',
  decision_enum: ['allow','redact','remove'], rule_ids: ['L1','L2','L3','L4'],
  language: 'java', frameworks: ['slf4j'], source_roots: ['src/main/java'],
  manifest_list: ['pom.xml'], target_question: 'Should this log call be allowed under PII rules?'
}));
const out = join(dir, 'out');
const r = spawnSync('node', ['bin/stamp.mjs', '--config='+cfg, '--templates=templates', '--out='+out], { encoding: 'utf8' });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
const disc = readFileSync(join(out, 'prompts/discovery.md'), 'utf8');
console.log('discovery.md length:', disc.length, 'chars');
console.log('has step 5 role-expansion:', disc.includes('Role-based expansion'));
console.log('has phase-c-expansion reference:', disc.includes('phase-c-expansion'));
console.log('has AGENTIC_ANALYZER_NONINTERACTIVE:', disc.includes('AGENTIC_ANALYZER_NONINTERACTIVE'));
console.log('unresolved tokens:', (disc.match(/\\{\\{[A-Z_]+\\}\\}/g) || []).length);
"
```

Expected:
- `has step 5 role-expansion: true`
- `has phase-c-expansion reference: true`
- `has AGENTIC_ANALYZER_NONINTERACTIVE: true`
- `unresolved tokens: 0`

### Step 4.5 — Commit

```
cd plugins/agentic-analyzer && git add plugins/agentic-analyzer/_core/templates/prompts/discovery.md.tmpl && git commit -m "feat(discovery): Phase C.2 step 5 — role-expansion orchestration

Task 4 of docs/superpowers/plans/2026-04-22-role-based-similar-entity-discovery.md.
Adds step 5 to Phase C.2 of the discovery prompt, sitting between
framework-expansion (step 4) and the closing summary (renumbered to
step 6). Sub-steps 5.1-5.7 cover: building the role-inferencer's
input brief (enriched oracle_hits + Serena overviews + file_tops),
dispatching the subagent and validating its envelope, tier-gating
on self-assessed confidence (autonomous / interactive /
non-interactive-skip), executing Serena or Grep-fallback queries
with a 200-candidate cap, interactive Accept/Refine/Reject/Skip
prompt, unconditional phase-c-expansion telemetry with
strategy_type, and defensive candidates.json re-validation. Step 5
failures degrade gracefully — never abort the run.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Extend analyzer-reviewer with role-expansion invariants

**Files:**
- Modify: `plugins/agentic-analyzer/agents/analyzer-reviewer.md`

### Step 5.1 — Locate insertion point

Open `plugins/agentic-analyzer/agents/analyzer-reviewer.md` and find the `**Oracle / Phase C.2 backstop (when ...)** ` section heading. The last checkbox in that section is:

```
- [ ] Every backstop-name that resolves to zero hits: is there a
      `stage: "phase-c"` degradation naming it? Silent drops defeat
      the entire purpose of the oracle.
```

### Step 5.2 — Append role-expansion invariants

Immediately after that checkbox (and before the next section, which is `## How to write your review`), insert this block:

```

**Role-expansion (Phase C.2 step 5)**

- [ ] Does the discovery prompt actually run step 5 after step 4?
      Grep `prompts/discovery.md` for `role-expansion` — the step 5
      orchestration should include dispatch of `role-inferencer` and
      the tier-gate.
- [ ] Is the `role-inferencer` envelope validated against
      `_core/schema/role-inferencer-envelope.schema.json` BEFORE any
      query executes? Invalid envelopes must become a
      `phase-c-expansion` degradation, not execution attempts.
- [ ] Does the agent's envelope meet the evidence-first rule? Every
      criterion has `evidence[]` citing >=1 oracle hit, and the
      strategy's `confidence` is `medium` or lower when any criterion
      has `ground_count < 2`.
- [ ] Does every strategy include >=3 `negative_examples`? Missing
      negative examples = the agent didn't think about false
      positives; the orchestrator should reject such envelopes.
- [ ] Does the agent refuse to re-propose already-expanded frameworks?
      Check: `frameworks_already_expanded[]` in the brief excluded
      from any strategy whose queries reduce to "find callers of X".
- [ ] Only the **rank-1** strategy is eligible for autonomous
      execution per run. Lower-ranked strategies land in
      `uncertainties[]`, not in extra auto-executed passes.
- [ ] Is the **200-candidate cap** enforced per run? Check the cap-
      reached degradation fires when exceeded.
- [ ] In interactive mode, does the orchestrator actually wait for
      A/R/J/S? Auto-proceeding on ambiguous replies is a bug.
- [ ] Does `AGENTIC_ANALYZER_NONINTERACTIVE=1` correctly disable the
      interactive fallback and emit the `role-expansion-skipped`
      degradation for medium/low-confidence strategies?
- [ ] Are role-expansion candidates tagged
      `"phase": "C.2-role-expansion"` in `analysis.json`? Untagged
      candidates mean the classification stage can't distinguish
      oracle-backstop evidence from role-expansion evidence when
      rule-authoring needs to.
- [ ] Does every `phase-c-expansion` degradation emitted by step 5
      carry a `strategy_type` field and include the full
      `role_description` in the `reason` string? Without these, the
      audit trail is useless.
```

### Step 5.3 — Commit

```
cd plugins/agentic-analyzer && git add plugins/agentic-analyzer/agents/analyzer-reviewer.md && git commit -m "docs(analyzer-reviewer): role-expansion (Phase C.2 step 5) checklist

Task 5 of docs/superpowers/plans/2026-04-22-role-based-similar-entity-discovery.md.
Adds 11 checklist items covering role-inferencer envelope
validation, evidence-first criteria, >=3 negative_examples per
strategy, rejection of already-expanded frameworks, rank-1 only,
200-candidate cap, interactive A/R/J/S handling,
AGENTIC_ANALYZER_NONINTERACTIVE semantics, candidate tagging, and
degradation audit trail completeness.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Update PATTERN-CARD.md runtime phases

**Files:**
- Modify: `plugins/agentic-analyzer/docs/PATTERN-CARD.md`

### Step 6.1 — Update the Phase C runtime row

In `docs/PATTERN-CARD.md`, find the runtime phases code block. Current Phase C row:

**Before:**
```
4  Phase C         C.1 ad-hoc + config (optional per domain)
                    C.2 expected-entities backstop (runs when oracle file exists,
                        with single-run framework expansion gated ≥2 hits,
                        capped at 200 candidates)  → candidates.json
```

**After:**
```
4  Phase C         C.1 ad-hoc + config (optional per domain)
                    C.2 expected-entities backstop (runs when oracle file exists):
                        step 4 framework-expansion (cluster ≥2 hits on library
                          not in frameworks[], Context7+Serena survey, cap 200)
                        step 5 role-expansion (role-inferencer subagent proposes
                          search strategies; tier-gated autonomous/interactive/
                          skip on AGENTIC_ANALYZER_NONINTERACTIVE; cap 200
                          per strategy; rank-1 only)
                    → candidates.json
```

### Step 6.2 — Update the degradation stages block

Find the `## Coverage degradation stages` code block. Replace the `phase-c-expansion` line:

**Before:**
```
phase-c-expansion   within-run framework expansion occurred or hit its
                    200-candidate cap. Telemetry, not a failure.
```

**After:**
```
phase-c-expansion   within-run expansion occurred (framework-based in step 4,
                    role-based in step 5) or hit its 200-candidate cap.
                    Telemetry, not a failure. Entries carry an optional
                    strategy_type field (framework | annotation | call_pattern |
                    name_pattern | path_pattern | combination).
```

### Step 6.3 — Commit

```
cd plugins/agentic-analyzer && git add docs/PATTERN-CARD.md && git commit -m "docs(pattern-card): Phase C.2 role-expansion + strategy_type

Task 6 of docs/superpowers/plans/2026-04-22-role-based-similar-entity-discovery.md.
Phase C row in the runtime phases block now enumerates step 4
(framework-expansion) and step 5 (role-expansion) separately.
Degradation stages block clarifies phase-c-expansion covers both
flavours and mentions the new optional strategy_type field's enum.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Add [Unreleased] CHANGELOG entry

**Files:**
- Modify: `CHANGELOG.md`

### Step 7.1 — Populate [Unreleased]

Open `CHANGELOG.md`. Immediately below the `## [Unreleased]` header (currently empty, sitting atop the released `## [0.3.0] — 2026-04-22` block), insert:

```

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
  `true` / `yes`, low-confidence role-expansion strategies are
  skipped with a `role-expansion-skipped` degradation instead of
  prompting for user approval. Makes `/analyze-<name>` CI-safe.

### Documentation

- `agents/analyzer-reviewer.md` extended with an 11-item
  Role-expansion checklist section.
- `docs/PATTERN-CARD.md` runtime phases block now enumerates step 4
  (framework-expansion) and step 5 (role-expansion) separately;
  degradation stages block documents the new `strategy_type` field.
```

### Step 7.2 — Commit

```
cd plugins/agentic-analyzer && git add CHANGELOG.md && git commit -m "docs(changelog): role-expansion entries for [Unreleased]

Task 7 of docs/superpowers/plans/2026-04-22-role-based-similar-entity-discovery.md.
Populates the [Unreleased] block with the v0.4.0 additions:
Phase C.2 step 5 (role-expansion), role-inferencer envelope
schema, strategy_type field on coverage degradations,
AGENTIC_ANALYZER_NONINTERACTIVE env var, plus docs updates.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Integration verification + final test suite

**Files:** none modified — verification only.

### Step 8.1 — Run the full test suite

```
cd plugins/agentic-analyzer/_core && npm test 2>&1 | tail -10
```

Expected: `tests 139, pass 139, fail 0` (133 baseline + 5 from Task 1 + 1 from Task 2).

### Step 8.2 — End-to-end stamp check

```
cd plugins/agentic-analyzer/_core && node -e "
const { spawnSync } = require('child_process');
const { mkdtempSync, writeFileSync, readFileSync, readdirSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');
const dir = mkdtempSync(join(tmpdir(), 'plan-final-'));
const cfg = join(dir, 'config.json');
writeFileSync(cfg, JSON.stringify({
  analyzer_name: 'logging', entity_name_human: 'Log call-site', entity_key: 'entries',
  id_field: 'call_site_id', target_const: 'pii-regulated',
  decision_enum: ['allow','redact','remove'], rule_ids: ['L1','L2','L3','L4'],
  language: 'java', frameworks: ['slf4j'], source_roots: ['src/main/java'],
  manifest_list: ['pom.xml'], target_question: 'Should this log call be allowed under PII rules?'
}));
const out = join(dir, 'out');
const r = spawnSync('node', ['bin/stamp.mjs', '--config='+cfg, '--templates=templates', '--out='+out], { encoding: 'utf8' });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
// Verify discovery.md stamps clean + contains step 5 text
const disc = readFileSync(join(out, 'prompts/discovery.md'), 'utf8');
console.log('discovery.md step 5 present:', disc.includes('Role-based expansion'));
console.log('discovery.md NONINTERACTIVE env var mention:', disc.includes('AGENTIC_ANALYZER_NONINTERACTIVE'));
console.log('discovery.md role-inferencer dispatch mention:', disc.includes('role-inferencer'));
console.log('discovery.md no unresolved tokens:', (disc.match(/\\{\\{[A-Z_]+\\}\\}/g) || []).length === 0);
// Verify coverage schema strategy_type
const cov = JSON.parse(readFileSync(join(out, 'schema/coverage.schema.json'), 'utf8'));
console.log('coverage.strategy_type present:', !!cov.properties.degradations.items.properties.strategy_type);
"
```

Expected: all five lines print `true`.

### Step 8.3 — Envelope schema round-trip

```
cd plugins/agentic-analyzer/_core && node bin/validate.mjs schema/role-inferencer-envelope.schema.json /dev/stdin <<'EOF'
{
  "strategies": [{
    "rank": 1,
    "strategy_type": "call_pattern",
    "role_description": "calls to Logger.info/warn/error with a format-string arg",
    "criteria": [{
      "criterion": "receiver is typed org.slf4j.Logger",
      "evidence": ["userSignupLogger @ Foo.java:42", "orderAuditLogger @ Bar.java:17"],
      "ground_count": 2
    }],
    "serena_queries": [{"tool": "find_symbol", "name_path": "Logger/info", "substring_matching": false}],
    "grep_fallback_patterns": ["\\blog\\.(info|warn|error)\\s*\\("],
    "exclude_patterns": ["test/"],
    "estimated_hit_count": "10-100",
    "confidence": "high",
    "negative_examples": ["System.out.println", "log.debug", "printf"]
  }]
}
EOF
```

Expected: exit code `0` (no stdout / stderr). Validates a realistic envelope end-to-end.

### Step 8.4 — Final commit (if any verification-only changes accumulated)

No code changes expected here; if the verification loop uncovered drift, file a fix task and re-run. Otherwise, no commit.

---

## Self-review checklist

- [x] Spec coverage: every Section (Architecture / Tier-gate / Agent input+output+rules / Orchestrator steps 5.1–5.7 / Files / Out of scope / Security / Observability / Version) maps to a task.
- [x] No placeholders: all code blocks are literal; all commit messages are literal; no "similar to Task N" shortcuts.
- [x] Type/signature consistency: `strategy_type` enum is identical in envelope schema, coverage schema, and agent prose. Confidence weights (high=1.0, medium=0.5, low=0.2) match between agent rules 6 and 8.
- [x] `AGENTIC_ANALYZER_NONINTERACTIVE` naming identical across all files (orchestrator, agent, CHANGELOG, PATTERN-CARD, analyzer-reviewer).
- [x] Cap=200 mentioned consistently in orchestrator, agent threshold, CHANGELOG, PATTERN-CARD, analyzer-reviewer.
- [x] Scope: single plan, no subsystem decomposition needed.
