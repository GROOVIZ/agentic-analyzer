# Entity properties — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record a free-form, per-entity `properties` bag (string / number / boolean / null values) as structured rationale and queryable analytics, populated first as a side-effect of rule firing and then consolidated by a dedicated extraction pass (Phase D.5).

**Architecture:** `analysis.schema.json` gains an optional `properties: { [key]: scalar }` field on each entity. Rules declare which property keys they are responsible for populating in a new `Properties to set` column of the `rules.md` table. The classification prompt emits those keys as a side-effect when a rule fires (Phase D). A new Phase D.5 consolidation step runs a dedicated extraction prompt (`prompts/properties.md`) against any entry whose `rule_fired` declared keys that were not populated in Phase D; unresolvable keys are set to `null` with a `coverage.degradations[]` entry. Properties are **open** — no enum or type constraint per key in the MVP; we only constrain value types to primitives. Closed per-key schemas are deliberately deferred to v2 once real-world property shapes stabilize.

**Tech Stack:** Node 20+, Ajv 2020, `node --test`, markdown-driven templating via `_core/bin/stamp.mjs`.

**Scope boundary (what this plan does NOT include):**
- No rule-author MODE: refine / refactoring loop.
- No auto-validation of property keys against a closed enum — the author is trusted.
- No array or nested-object values; values are `string | number | boolean | null`.
- No UI / reporting on properties; they're just emitted for downstream consumers.
- No migration of existing `analysis.json` runs; `properties` is optional.

---

## File structure

| File | Action | Responsibility |
|------|--------|---------------|
| `plugins/agentic-analyzer/_core/templates/schema/analysis.schema.json.tmpl` | Modify | Add optional `properties` field to the entity schema. |
| `plugins/agentic-analyzer/_core/bin/scaffold-e2e.test.mjs` | Modify | Add tests that stamped analysis schema accepts `properties` and rejects non-primitive values. |
| `plugins/agentic-analyzer/agents/rule-author.md` | Modify | Update MODE: dispatch `rules_md structure` to include the new `Properties to set` column. |
| `plugins/agentic-analyzer/_core/templates/prompts/classification.md.tmpl` | Modify | Tell the classifier to emit `properties` object populated with the keys declared by the rule that fired. |
| `plugins/agentic-analyzer/_core/templates/prompts/properties.md.tmpl` | Create | Dedicated extraction prompt used by Phase D.5 to backfill missing rule-declared properties. |
| `plugins/agentic-analyzer/_core/templates/SKILL.md.tmpl` | Modify | Insert a new **Step 6 — Phase D.5: Property consolidation** between classification and coverage; renumber later steps. |
| `plugins/agentic-analyzer/agents/analyzer-reviewer.md` | Modify | Add "Properties" section to the checklist. |
| `plugins/agentic-analyzer/docs/PATTERN-CARD.md` | Modify | Insert Phase D.5 into the runtime phases table. |

---

## Prerequisites (read these before starting)

1. Run the full suite to establish a green baseline:
   ```
   cd plugins/agentic-analyzer/_core && npm test
   ```
   Expected: `tests 131, pass 131, fail 0` (may be higher if other work has landed).

2. Read these files end-to-end once:
   - `plugins/agentic-analyzer/_core/templates/schema/analysis.schema.json.tmpl`
   - `plugins/agentic-analyzer/_core/templates/prompts/classification.md.tmpl`
   - `plugins/agentic-analyzer/_core/templates/SKILL.md.tmpl`
   - `plugins/agentic-analyzer/agents/rule-author.md` (focus on the "Dispatch mode" and "rules_md structure" sections, lines ~44-90)

3. Confirm understanding: properties are **per-entry**, **optional**, **primitive-valued**, and **declared per-rule** in a new rules.md column. Phase D.5 is a **consolidation** pass — it does not re-decide; it only backfills missing keys.

---

## Task 1: Extend `analysis.schema.json.tmpl` to accept an optional `properties` object

**Files:**
- Modify: `plugins/agentic-analyzer/_core/templates/schema/analysis.schema.json.tmpl`
- Test: `plugins/agentic-analyzer/_core/bin/scaffold-e2e.test.mjs`

### Step 1.1 — Write the failing tests

Add the two tests below to `scaffold-e2e.test.mjs`, placed alongside the existing `e2e: stamped analysis.schema.json validates a minimal entry` test. Insert immediately after that test, before the `e2e: stamped coverage.schema.json accepts phase-c-expansion` block.

```js
test("e2e: stamped analysis.schema.json accepts entries with a properties bag of primitives", async () => {
  const { default: Ajv2020 } = await import("ajv/dist/2020.js");
  const { default: addFormats } = await import("ajv-formats");
  const { dir, out, r } = scaffold(LOGGING_CONFIG);
  try {
    assert.equal(r.status, 0);
    const schema = JSON.parse(readFileSync(join(out, "schema/analysis.schema.json"), "utf8"));
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(schema);

    const doc = {
      schema_version: "1.0.0",
      ruleset_version: "2026-04-22",
      run_id: "r1",
      target: "pii-regulated",
      repository: { path: "/repo", commit: "abc" },
      coverage_ref: "./coverage.json",
      entries: [{
        call_site_id: "Foo.java:12",
        name: "log.info at Foo.java:12",
        source: {
          file: "Foo.java", line_start: 12, line_end: 14,
          snippet: "...", snippet_sha256: "a".repeat(64), snippet_normalized_sha256: "a".repeat(64)
        },
        decision: "allow",
        decision_source: "rule",
        rule_fired: "L1",
        rationale: "no PII token in message",
        confidence: "high",
        analysis_status: "complete",
        properties: {
          framework: "slf4j",
          log_level: "INFO",
          message_contains_pii_token: false,
          fallback_unavailable: null,
          enclosing_class_line: 10
        }
      }]
    };
    assert.ok(validate(doc), JSON.stringify(validate.errors, null, 2));
  } finally { cleanup(dir); }
});

test("e2e: stamped analysis.schema.json rejects non-primitive property values", async () => {
  const { default: Ajv2020 } = await import("ajv/dist/2020.js");
  const { default: addFormats } = await import("ajv-formats");
  const { dir, out, r } = scaffold(LOGGING_CONFIG);
  try {
    assert.equal(r.status, 0);
    const schema = JSON.parse(readFileSync(join(out, "schema/analysis.schema.json"), "utf8"));
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(schema);

    const baseEntry = {
      call_site_id: "Foo.java:12",
      name: "log.info at Foo.java:12",
      source: {
        file: "Foo.java", line_start: 12, line_end: 14,
        snippet: "...", snippet_sha256: "a".repeat(64), snippet_normalized_sha256: "a".repeat(64)
      },
      decision: "allow",
      decision_source: "rule",
      rule_fired: "L1",
      rationale: "no PII token",
      confidence: "high",
      analysis_status: "complete"
    };
    const baseDoc = {
      schema_version: "1.0.0",
      ruleset_version: "2026-04-22",
      run_id: "r1",
      target: "pii-regulated",
      repository: { path: "/repo", commit: "abc" },
      coverage_ref: "./coverage.json",
      entries: []
    };

    for (const bad of [
      { array_value: ["x"] },
      { nested_object: { a: 1 } }
    ]) {
      const doc = { ...baseDoc, entries: [{ ...baseEntry, properties: bad }] };
      assert.ok(!validate(doc), `expected rejection for ${JSON.stringify(bad)}`);
    }
  } finally { cleanup(dir); }
});
```

### Step 1.2 — Run the tests to verify RED

Run:
```
cd plugins/agentic-analyzer/_core && node --test bin/scaffold-e2e.test.mjs 2>&1 | grep -E "(pass |fail |tests )"
```

Expected: at least 2 failures (the two tests just added); previously-passing tests still pass.

### Step 1.3 — Add the `properties` field to the schema template

In `plugins/agentic-analyzer/_core/templates/schema/analysis.schema.json.tmpl`, change this block (lines 35-58 of the current file):

**Before:**
```json
        "properties": {
          "{{ID_FIELD}}": { "type": "string" },
          "name": { "type": "string" },
          "description": { "type": "string" },
          "source": {
            "type": "object",
            "additionalProperties": false,
            "required": ["file", "line_start", "line_end", "snippet", "snippet_sha256", "snippet_normalized_sha256"],
            "properties": {
              "file": { "type": "string" },
              "line_start": { "type": "integer", "minimum": 1 },
              "line_end": { "type": "integer", "minimum": 1 },
              "snippet": { "type": "string" },
              "snippet_sha256": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
              "snippet_normalized_sha256": { "type": "string", "pattern": "^[0-9a-f]{64}$" }
            }
          },
          "decision": { "enum": [{{DECISION_ENUM_WITH_NULL}}] },
          "decision_source": { "enum": ["rule", "override"] },
          "rule_fired": { "enum": [{{RULE_IDS_WITH_NONE}}] },
          "rationale": { "type": "string" },
          "confidence": { "enum": ["high", "medium", "low"] },
          "analysis_status": { "enum": ["complete", "partial", "needs_review"] }
        }
```

**After:**
```json
        "properties": {
          "{{ID_FIELD}}": { "type": "string" },
          "name": { "type": "string" },
          "description": { "type": "string" },
          "source": {
            "type": "object",
            "additionalProperties": false,
            "required": ["file", "line_start", "line_end", "snippet", "snippet_sha256", "snippet_normalized_sha256"],
            "properties": {
              "file": { "type": "string" },
              "line_start": { "type": "integer", "minimum": 1 },
              "line_end": { "type": "integer", "minimum": 1 },
              "snippet": { "type": "string" },
              "snippet_sha256": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
              "snippet_normalized_sha256": { "type": "string", "pattern": "^[0-9a-f]{64}$" }
            }
          },
          "decision": { "enum": [{{DECISION_ENUM_WITH_NULL}}] },
          "decision_source": { "enum": ["rule", "override"] },
          "rule_fired": { "enum": [{{RULE_IDS_WITH_NONE}}] },
          "rationale": { "type": "string" },
          "confidence": { "enum": ["high", "medium", "low"] },
          "analysis_status": { "enum": ["complete", "partial", "needs_review"] },
          "properties": {
            "type": "object",
            "description": "Open bag of per-entity evidence/analytics properties. Keys are analyzer-specific; values are restricted to primitives. Populated by the rule that fired (side-effect) and consolidated by Phase D.5.",
            "additionalProperties": {
              "type": ["string", "number", "boolean", "null"]
            }
          }
        }
```

Note: `properties` is NOT added to the `required` list. Existing analyzers and runs without a `properties` key continue to validate.

### Step 1.4 — Run the tests to verify GREEN

Run:
```
cd plugins/agentic-analyzer/_core && npm test 2>&1 | tail -5
```

Expected: full suite passes (old count + 2 new tests).

### Step 1.5 — Commit (optional, per your workflow)

```
git add plugins/agentic-analyzer/_core/templates/schema/analysis.schema.json.tmpl \
        plugins/agentic-analyzer/_core/bin/scaffold-e2e.test.mjs
git commit -m "feat(schema): add optional per-entity properties bag to analysis.schema"
```

---

## Task 2: Teach `rule-author` to emit the `Properties to set` column

**Files:**
- Modify: `plugins/agentic-analyzer/agents/rule-author.md`

No tests — rule-author is prose dispatched to a subagent. The contract is the envelope shape and the markdown string it returns; we're extending the markdown convention, not the envelope.

### Step 2.1 — Read the current `rules_md structure` section

Open `plugins/agentic-analyzer/agents/rule-author.md` and locate the section titled `### \`rules_md\` structure` (around lines 74-90). The current section 5 reads:

```
5. Rule labels — a markdown table with columns `ID | Rule | Decision`.
   One row per entry in `rule_ids`. Decisions are drawn from
   `decision_enum`, or the word `dropped` for a drop rule, or
   `needs_review` for the catch-all.
```

### Step 2.2 — Replace the table-spec and add the properties-authoring guidance

Replace the line "5. Rule labels …" block shown above with:

```
5. Rule labels — a markdown table with columns
   `ID | Rule | Decision | Properties to set`. One row per entry in
   `rule_ids`. Decisions are drawn from `decision_enum`, or the word
   `dropped` for a drop rule, or `needs_review` for the catch-all.

   The `Properties to set` cell is a comma-separated list of property
   keys this rule is responsible for populating on each entry it
   classifies. Keys are free-form but follow `snake_case` by
   convention; they may include analytics signals that DO NOT
   contribute to the rule's trigger (e.g., a `log_level` property is
   populated even when the rule's trigger is unrelated to log level,
   because population-level analytics wants it). Keep the list short
   (3-7 keys per rule). Leave the cell empty (`—` or blank) for the
   catch-all.
```

### Step 2.3 — Add a "Properties" subsection to the `Default ruleset shape` block

Still in `rule-author.md`, find the `### Default ruleset shape` section (around line 92). At the end of the existing bullet list in that section, append:

```

**Properties column defaults.** When inputs don't contradict them:

- Every non-catch-all rule declares at least one property. If you
  cannot name one, the rule is probably too specific.
- Include `framework` (or `provider`, `library`) as a standard key
  whenever `frameworks[]` is non-empty — useful for analytics.
- Include the rule's primary decision-impacting signal as a key
  (e.g., `message_contains_pii_token` for a logging PII rule, or
  `size_bounded` for a cache-size rule).
- The catch-all leaves `Properties to set` blank.
```

### Step 2.4 — Verify the envelope contract is unchanged

Confirm (by reading, not editing) that the `### Output envelope` section still specifies the same four fields: `ruleset_version`, `rules_md`, `rule_ids`, `uncertainties`. No changes needed there.

### Step 2.5 — Commit (optional)

```
git add plugins/agentic-analyzer/agents/rule-author.md
git commit -m "feat(rule-author): add Properties to set column to rules.md table"
```

---

## Task 3: Update `classification.md.tmpl` so rule firing emits `properties` as a side-effect

**Files:**
- Modify: `plugins/agentic-analyzer/_core/templates/prompts/classification.md.tmpl`
- Test: `plugins/agentic-analyzer/_core/bin/stamp.test.mjs` (placeholder-integrity check — already covered by existing tests)

No new tests are needed — this is template prose. The existing `stamp: real analysis.schema template` / `scaffold-e2e` tests guarantee placeholder integrity.

### Step 3.1 — Add the `properties` field to the per-entry output shape

In `plugins/agentic-analyzer/_core/templates/prompts/classification.md.tmpl`, change the JSON code block in the `## Per-entry output` section (currently lines 14-27):

**Before:**
```json
{
  "{{ID_FIELD}}": "<from candidate>",
  "name": "<from candidate>",
  "description": "<optional>",
  "source": { /* copied verbatim from candidate */ },
  "decision": "<one of: {{DECISION_ENUM_NO_NULL}} or null>",
  "decision_source": "rule",
  "rule_fired": "R<N>",
  "rationale": "<one sentence — quote the evidence>",
  "confidence": "high | medium | low",
  "analysis_status": "complete | partial | needs_review"
}
```

**After:**
```json
{
  "{{ID_FIELD}}": "<from candidate>",
  "name": "<from candidate>",
  "description": "<optional>",
  "source": { /* copied verbatim from candidate */ },
  "decision": "<one of: {{DECISION_ENUM_NO_NULL}} or null>",
  "decision_source": "rule",
  "rule_fired": "R<N>",
  "rationale": "<one sentence — quote the evidence>",
  "confidence": "high | medium | low",
  "analysis_status": "complete | partial | needs_review",
  "properties": {
    "<key_1>": "<primitive value | null>",
    "<key_2>": "<primitive value | null>"
  }
}
```

### Step 3.2 — Append a new `## Properties (side-effect emission)` section

After the `## Triage and short-circuits` section but before `## Catch-all`, insert this new section:

```
## Properties (side-effect emission)

When a rule fires, populate the entry's `properties` object with the
keys named in that rule's `Properties to set` column of `rules.md`.

Rules for property emission:

- **Emit only declared keys.** If the rule's row lists `framework,
  log_level`, emit exactly those two keys. Do NOT emit extras — the
  Phase D.5 consolidation pass is the authoritative place for
  analytics-wide keys.
- **Values are primitives.** Strings, numbers, booleans, or `null`.
  No nested objects, no arrays.
- **Prefer the evidence-grounded value.** If the key is
  `message_contains_pii_token`, set `true` or `false` based on the
  same evidence the rule's trigger read — not a guess.
- **Unavailable → `null`.** If the rule fires but you cannot
  determine a declared property from the snippet (e.g., the call
  site references a config value whose file Serena couldn't resolve),
  emit `null` for that key and drop `confidence` to `medium` if the
  key materially affected the decision, or leave `confidence`
  unchanged otherwise.
- **No key declared → empty object.** The catch-all (`R<last>`)
  typically has no declared keys; its entry still emits
  `"properties": {}` (never omit the field — schema accepts omission,
  but Phase D.5 expects a bag to merge into). Write an empty object.
- **Do NOT invent keys.** If you find an interesting signal not
  declared by any rule, record it in `rationale` instead. Adding
  undeclared keys here fragments the analytics surface and Phase D.5
  won't backfill them.

The schema allows `additionalProperties: { type: ["string", "number",
"boolean", "null"] }` on the properties bag — non-primitive values
fail validation, which hard-fails the run.
```

### Step 3.3 — Stamp the template in isolation and inspect

Run:
```
cd plugins/agentic-analyzer/_core && npm test 2>&1 | tail -5
```

Expected: full suite still passes (the scaffold-e2e "no unresolved placeholders in discovery prompt" test covers classification prompt by extension, and the added prose uses only existing tokens).

### Step 3.4 — Commit (optional)

```
git add plugins/agentic-analyzer/_core/templates/prompts/classification.md.tmpl
git commit -m "feat(classification): populate properties as side-effect of rule firing"
```

---

## Task 4: Create `prompts/properties.md.tmpl` — the Phase D.5 extraction prompt

**Files:**
- Create: `plugins/agentic-analyzer/_core/templates/prompts/properties.md.tmpl`
- Test: existing scaffold-e2e placeholder-integrity check will cover it automatically.

### Step 4.1 — Create the new template file

Create the file `plugins/agentic-analyzer/_core/templates/prompts/properties.md.tmpl` with this exact content:

```
# Property consolidation prompt (Phase D.5)

You are running the property-consolidation phase of {{ANALYZER_NAME}}
analysis. This phase runs AFTER classification (Phase D) has produced
`analysis.json`. Its job is to backfill property keys that were
declared by the rule that fired but not populated during classification.

## Inputs

For each entry in `{{ENTITY_KEY}}[]` where `rule_fired` is not the
catch-all:

1. Look up the rule's row in `rules.md` and extract the
   `Properties to set` cell — the comma-separated list of property
   keys this rule is responsible for.
2. Compare against the entry's existing `properties` object.
3. If every declared key is already present in `properties`, SKIP
   this entry — there is nothing to consolidate.
4. Otherwise, identify the **missing keys** (declared by rule but not
   in `properties`).

## For each missing key, extract a value

Read the entry's `source.snippet` plus (if needed) a 30-line Read
around `source.file` at `[source.line_start - 15, source.line_end + 15]`.
Determine the value for the missing key:

- Return a primitive (`string`, `number`, `boolean`) when the snippet
  provides unambiguous evidence.
- Return `null` when:
  - The snippet does not contain the information.
  - The information would require cross-file reasoning Serena cannot
    confirm.
  - The key's meaning is ambiguous for this rule (e.g., a
    `framework` key on a plain-stdlib call site).
- NEVER fabricate. If you cannot decide, choose `null`. The
  downstream consumer distinguishes `null` from absence.

Do not re-extract keys that are already present — they were populated
by the rule at classification time and are authoritative.

## Output shape (per entry)

Return a partial `properties` object containing ONLY the keys you
extracted in this pass. The runtime merges it into the entry's
existing `properties`:

```json
{
  "{{ID_FIELD}}": "<entry id>",
  "properties": {
    "<missing_key_1>": "<primitive | null>",
    "<missing_key_2>": "<primitive | null>"
  }
}
```

If you extracted zero values, return:
```json
{
  "{{ID_FIELD}}": "<entry id>",
  "properties": {}
}
```

## Missing after extraction → degradation

For each key that ends up `null` after your best-effort extraction,
the orchestrator appends a `coverage.degradations[]` entry with
`stage: "classification"` and
`reason: "property extraction failed: <key> for rule <rule_fired>"`.
You do NOT write degradations directly — that is the orchestrator's
job.

## Hard rules

- Catch-all entries (`rule_fired` = `R<last>`) are skipped entirely
  by this phase. Their `properties` object stays empty.
- Do not alter `decision`, `decision_source`, `rule_fired`,
  `rationale`, `confidence`, or any other entry field. Phase D.5 is
  strictly additive on the `properties` object.
- Never re-run a rule's trigger logic here. Phase D.5 is extraction,
  not re-classification.
- Do not invent property keys the rule did not declare. Analytics-
  wide keys are out of scope for MVP.
```

### Step 4.2 — Verify the template stamps cleanly

Run the full suite:
```
cd plugins/agentic-analyzer/_core && npm test 2>&1 | tail -5
```

Expected: full suite still passes. The existing scaffold-e2e placeholder-integrity check auto-covers the new file — it walks `prompts/*` and asserts no unresolved `{{…}}` remain after stamping.

### Step 4.3 — Spot-check the stamped output

Run a manual stamp against the caches config to eyeball the output:

```
cd plugins/agentic-analyzer/_core && node -e "
const { spawnSync } = require('child_process');
const { mkdtempSync, writeFileSync, readFileSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');
const dir = mkdtempSync(join(tmpdir(), 'plan-stamp-'));
const cfg = join(dir, 'config.json');
writeFileSync(cfg, JSON.stringify({
  analyzer_name: 'caches', entity_name_human: 'Cache', entity_key: 'caches',
  id_field: 'cache_id', target_const: 'multi-replica-openshift',
  decision_enum: ['retain', 'externalize', 'remove'],
  rule_ids: ['R1','R2','R3','R4','R5','R6','R7','R8','R9','R10'],
  language: 'java', frameworks: ['caffeine'], source_roots: ['src/main/java'],
  manifest_list: ['pom.xml'], target_question: 'Is this cache safe on multi-replica OpenShift?'
}));
const out = join(dir, 'out');
const r = spawnSync('node', ['bin/stamp.mjs', '--config='+cfg, '--templates=templates', '--out='+out], { encoding: 'utf8' });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
console.log(readFileSync(join(out, 'prompts/properties.md'), 'utf8').slice(0, 400));
"
```

Expected: first 400 characters of the stamped `prompts/properties.md`, with `{{ANALYZER_NAME}}` replaced by `caches`, `{{ENTITY_KEY}}` by `caches`, `{{ID_FIELD}}` by `cache_id`. No `{{…}}` tokens remain.

### Step 4.4 — Commit (optional)

```
git add plugins/agentic-analyzer/_core/templates/prompts/properties.md.tmpl
git commit -m "feat(phase-d.5): add properties.md extraction prompt"
```

---

## Task 5: Insert Phase D.5 (property consolidation) into `SKILL.md.tmpl`

**Files:**
- Modify: `plugins/agentic-analyzer/_core/templates/SKILL.md.tmpl`

### Step 5.1 — Insert a new Phase D.5 step

In `plugins/agentic-analyzer/_core/templates/SKILL.md.tmpl`, locate the block that currently reads (around lines 100-127):

```
## Step 5 — Phase D: Classification

Follow `prompts/classification.md`. Apply rules from `rules.md` in the
evaluation order documented there.

Write `{{ANALYZER_NAME}}-analysis/output/runs/<run-id>/analysis.json`:
…
Validate:

```
node $SKILL_DIR/bin/validate.mjs $SKILL_DIR/schema/analysis.schema.json {{ANALYZER_NAME}}-analysis/output/runs/<run-id>/analysis.json
```

## Step 6 — Coverage
```

Immediately **after** the `Validate:` code block for Step 5 (the `node $SKILL_DIR/bin/validate.mjs …analysis.schema.json…` command) and **before** `## Step 6 — Coverage`, insert the following new step:

```
## Step 5.5 — Phase D.5: Property consolidation

Follow `prompts/properties.md`. For every entry in `{{ENTITY_KEY}}[]`
whose `rule_fired` is NOT the catch-all:

1. Look up the `Properties to set` column for that rule in `rules.md`.
2. Compare against the entry's existing `properties` object.
3. If any declared key is missing, run the extraction prompt on the
   entry's snippet and merge the returned partial `properties` into
   the entry.
4. For each key that ends up `null` after extraction, append a
   `coverage.degradations[]` entry:
   ```json
   {
     "stage": "classification",
     "reason": "property extraction failed: <key> for rule <rule_fired>"
   }
   ```

Re-validate `analysis.json` after the consolidation pass:

```
node $SKILL_DIR/bin/validate.mjs $SKILL_DIR/schema/analysis.schema.json {{ANALYZER_NAME}}-analysis/output/runs/<run-id>/analysis.json
```

Phase D.5 is strictly additive — it writes only to each entry's
`properties` object, never to `decision`, `rule_fired`, `rationale`,
or any other field. Catch-all entries are skipped entirely.

```

Leave the subsequent `## Step 6 — Coverage`, `## Step 7 — Override carry-forward`, `## Step 8 — Update latest.txt`, and `## Step 9 — Summary` numbering UNCHANGED. We intentionally number the new step `5.5` rather than renumbering 6→7, 7→8, etc., because downstream reviewer notes and the PATTERN-CARD runtime table reference the existing numbers and we want to minimize diff surface.

### Step 5.2 — Run the full suite

```
cd plugins/agentic-analyzer/_core && npm test 2>&1 | tail -5
```

Expected: 131/131 + Task 1's 2 new tests = 133/133 pass.

### Step 5.3 — Commit (optional)

```
git add plugins/agentic-analyzer/_core/templates/SKILL.md.tmpl
git commit -m "feat(SKILL.md): add Phase D.5 property consolidation step"
```

---

## Task 6: Extend `analyzer-reviewer` checklist with a Properties section

**Files:**
- Modify: `plugins/agentic-analyzer/agents/analyzer-reviewer.md`

### Step 6.1 — Locate the insertion point

Open `plugins/agentic-analyzer/agents/analyzer-reviewer.md` and find the end of the **Overrides** section (just before the **Oracle / Phase C.2 backstop** section). The `- [ ]` item "When overrides are orphaned (no matching live entry), are they preserved, not deleted?" is the final item of the Overrides section.

### Step 6.2 — Insert a new `**Properties (Phase D / D.5)**` section

Immediately before the `**Oracle / Phase C.2 backstop …**` section header, insert:

```
**Properties (Phase D / D.5)**

- [ ] Does the `rules.md` table include a `Properties to set` column,
      with at least one key declared per non-catch-all rule?
- [ ] Do all declared property keys appear in the stamped
      `analysis.schema.json` entry schema as permissible additional
      properties? (They should; the schema uses
      `additionalProperties: { type: primitives }` — no key-level
      constraint.)
- [ ] In a real `analysis.json` output: for every entry whose
      `rule_fired` is not the catch-all, does `entries[i].properties`
      contain at least the keys declared in the rule's
      `Properties to set` cell? Missing keys indicate Phase D.5 is
      not running or the extraction prompt is silently failing.
- [ ] For every property key that is `null` in `entries[i].properties`,
      is there a matching `coverage.degradations[]` entry with
      `stage: "classification"` and a reason that names the key and
      the rule? Silent nulls defeat the auditability goal.
- [ ] Are property values always primitives (string / number /
      boolean / null)? Arrays and nested objects are schema
      violations.
- [ ] Does the catch-all entry's `properties` object stay empty?
      Phase D.5 must skip catch-all entries — re-extracting for them
      implies re-classification, which Phase D.5 is explicitly not.

```

### Step 6.3 — Commit (optional)

```
git add plugins/agentic-analyzer/agents/analyzer-reviewer.md
git commit -m "docs(analyzer-reviewer): add Properties / Phase D.5 checklist"
```

---

## Task 7: Update `PATTERN-CARD.md` runtime phases table

**Files:**
- Modify: `plugins/agentic-analyzer/docs/PATTERN-CARD.md`

### Step 7.1 — Insert Phase D.5 into the runtime phases code block

In `docs/PATTERN-CARD.md`, locate the `## Runtime phases (scaffolded SKILL.md)` section and the code block that follows it. The current block lists phases 1-9:

```
1  Preflight       path, Serena, Context7, run-id, mkdir output
2  Phase A         framework survey (Context7)            → _phaseA.json
3  Phase B         symbolic enumeration (Serena)          → _phaseB.json
4  Phase C         C.1 ad-hoc + config (optional per domain)
                   C.2 expected-entities backstop (runs when oracle file exists,
                       with single-run framework expansion gated ≥2 hits,
                       capped at 200 candidates)  → candidates.json
5  Phase D         rule classification                    → analysis.json
6  Coverage        degradations, counters                 → coverage.json
7  Override replay (entity_id + snippet hash) match       → analysis.json mutated
8  Latest pointer  printf '%s' <run-id> > latest.txt
9  Summary         print to session
```

Insert a new Phase D.5 row between lines "5  Phase D" and "6  Coverage":

```
5   Phase D         rule classification + side-effect properties → analysis.json
5.5 Phase D.5       property consolidation (dedicated extraction for keys
                    declared by rule but missing from side-effect output;
                    appends nulls + degradations for unresolvable keys)
                    → analysis.json (additive)
6   Coverage        degradations, counters                 → coverage.json
```

(Replace only the two lines `5  Phase D …` and `6  Coverage …` in the block; leave all other lines unchanged.)

### Step 7.2 — Add a short note to the prose immediately below the block

The text after the code block currently reads:

```
Each arrow is a schema-gated boundary. `validate.mjs` runs between
every pair; non-zero exit aborts the run.
```

Append this paragraph immediately after:

```

Phase D.5 is strictly additive on each entry's `properties` object —
it never rewrites decisions or rules. The schema boundary between 5.5
and 6 is the same `analysis.schema.json` as between 5 and 5.5;
additive writes cannot break it, so the boundary is re-validated
defensively rather than preventively.
```

### Step 7.3 — Commit (optional)

```
git add plugins/agentic-analyzer/docs/PATTERN-CARD.md
git commit -m "docs(pattern-card): add Phase D.5 to runtime phases"
```

---

## Task 8: Final integration verification

**Files:** none modified — verification only.

### Step 8.1 — Run the full test suite

```
cd plugins/agentic-analyzer/_core && npm test 2>&1 | tail -10
```

Expected: 133/133 pass (original 131 + two schema tests from Task 1).

### Step 8.2 — Stamp a full scaffold and inspect the results

```
cd plugins/agentic-analyzer/_core && node -e "
const { spawnSync } = require('child_process');
const { mkdtempSync, writeFileSync, readFileSync, readdirSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');
const dir = mkdtempSync(join(tmpdir(), 'plan-integration-'));
const cfg = join(dir, 'config.json');
writeFileSync(cfg, JSON.stringify({
  analyzer_name: 'logging', entity_name_human: 'Log call-site', entity_key: 'entries',
  id_field: 'call_site_id', target_const: 'pii-regulated',
  decision_enum: ['allow', 'redact', 'remove'],
  rule_ids: ['L1','L2','L3','L4'],
  language: 'java', frameworks: ['slf4j'], source_roots: ['src/main/java'],
  manifest_list: ['pom.xml'], target_question: 'Should this log call be allowed under PII rules?'
}));
const out = join(dir, 'out');
const r = spawnSync('node', ['bin/stamp.mjs', '--config='+cfg, '--templates=templates', '--out='+out], { encoding: 'utf8' });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
console.log('Stamped files:');
for (const f of readdirSync(out)) console.log(' ', f);
console.log('prompts:');
for (const f of readdirSync(join(out, 'prompts'))) console.log(' ', f);
console.log('\\n=== analysis.schema.json (properties field) ===');
const analysis = JSON.parse(readFileSync(join(out, 'schema/analysis.schema.json'), 'utf8'));
console.log(JSON.stringify(analysis.properties.entries.items.properties.properties, null, 2));
console.log('\\n=== properties.md first 300 chars ===');
console.log(readFileSync(join(out, 'prompts/properties.md'), 'utf8').slice(0, 300));
"
```

Expected output:
- Stamped files include `prompts/properties.md` (new).
- `analysis.schema.json.properties.entries.items.properties.properties` is an object with `type: object` and `additionalProperties: { type: […] }`.
- `properties.md` starts with `# Property consolidation prompt (Phase D.5)` and contains no `{{…}}` tokens.

### Step 8.3 — Run validate-scaffold against a freshly-stamped dir

```
cd plugins/agentic-analyzer/_core && node -e "
const { spawnSync } = require('child_process');
const { mkdtempSync, writeFileSync, copyFileSync, mkdirSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');
const dir = mkdtempSync(join(tmpdir(), 'plan-validate-'));
const cfg = join(dir, 'config.json');
writeFileSync(cfg, JSON.stringify({
  analyzer_name: 'logging', entity_name_human: 'Log call-site', entity_key: 'entries',
  id_field: 'call_site_id', target_const: 'pii-regulated',
  decision_enum: ['allow','redact','remove'], rule_ids: ['L1','L2'],
  language: 'java', frameworks: ['slf4j'], source_roots: ['src/main/java'],
  manifest_list: ['pom.xml'], target_question: 'Q?'
}));
const out = join(dir, 'out');
let r = spawnSync('node', ['bin/stamp.mjs', '--config='+cfg, '--templates=templates', '--out='+out], { encoding: 'utf8' });
if (r.status !== 0) { console.error('stamp failed:', r.stderr); process.exit(1); }
// Simulate /new-analyzer post-stamp: write rules.md + copy bin + make fixture dirs.
writeFileSync(join(out, 'rules.md'), '# rules\\n\\n| ID | Rule | Decision | Properties to set |\\n|----|------|----------|-------------------|\\n| L1 | a | allow | framework, log_level |\\n| L2 | b | redact | framework, pii_types |\\n');
mkdirSync(join(out, 'bin'), { recursive: true });
for (const f of ['_args.mjs','validate.mjs','normalize.mjs','compare-fixture.mjs','replay-overrides.mjs','migrate-overrides-v1-v2.mjs','fixture-init.mjs']) {
  copyFileSync(join('bin', f), join(out, 'bin', f));
}
mkdirSync(join(out, 'fixtures/L1'), { recursive: true });
mkdirSync(join(out, 'fixtures/L2'), { recursive: true });
writeFileSync(join(out, 'fixtures/L1/expected.json'), '{}');
writeFileSync(join(out, 'fixtures/L2/expected.json'), '{}');
r = spawnSync('node', ['bin/validate-scaffold.mjs', out, '--rule-ids=L1,L2'], { encoding: 'utf8' });
console.log('exit', r.status);
console.log('stdout:', r.stdout);
console.log('stderr:', r.stderr);
"
```

Expected: `exit 0`, `stdout: scaffold ok: <path>`. If not, the cross-check (Task 1 of the previous batch) is disagreeing with the rules.md table we wrote — debug by reading the stderr before proceeding.

### Step 8.4 — Final commit (if committing incrementally was skipped)

If the individual per-task commits were skipped, commit everything at once:

```
git add plugins/agentic-analyzer/_core/templates/schema/analysis.schema.json.tmpl \
        plugins/agentic-analyzer/_core/templates/prompts/classification.md.tmpl \
        plugins/agentic-analyzer/_core/templates/prompts/properties.md.tmpl \
        plugins/agentic-analyzer/_core/templates/SKILL.md.tmpl \
        plugins/agentic-analyzer/_core/bin/scaffold-e2e.test.mjs \
        plugins/agentic-analyzer/agents/rule-author.md \
        plugins/agentic-analyzer/agents/analyzer-reviewer.md \
        plugins/agentic-analyzer/docs/PATTERN-CARD.md
git commit -m "feat(properties): per-entity properties bag + Phase D.5 consolidation

- analysis.schema adds optional properties: { [k]: primitive | null }
- rules.md table gains 'Properties to set' column
- classification prompt emits declared keys as side-effect
- new prompts/properties.md consolidates missing keys in Phase D.5
- SKILL.md runtime gains Phase D.5 step (additive, no decision changes)
- analyzer-reviewer + PATTERN-CARD updated
"
```

---

## Design notes (for future work, not part of this plan)

**v2 candidates, deliberately deferred:**

- **Closed property schema per analyzer.** Once real analyzers have run for a while and property-key usage stabilizes, replace the open bag with a per-analyzer declared schema (authored alongside `rules.md`, stamped into `analysis.schema.json`). Enables enum validation, range checks, required-keys invariants.
- **Analyzer-wide "always collect" keys.** Let authors declare a set of keys Phase D.5 populates regardless of which rule fired. Useful for pure analytics (e.g., always record `framework` even for catch-all entries).
- **Array and nested-object value types.** If real properties demand lists (`pii_types: ["email", "ssn"]`), extend the schema's `additionalProperties.type` union. Delay until at least one real analyzer asks for it.
- **Rules as pure functions over properties.** Once properties are authoritative, a rule's trigger could be rewritten as "when `properties.X == Y`" rather than "when the snippet contains pattern Z." Rules become pure predicates over the property bag; classification decouples from snippet re-inspection. Big architectural win but only meaningful once properties are reliably populated.
- **Property-based overrides.** Allow a reviewer to correct `properties.X` on an override without changing the decision. Currently `overrides.json` is decision-only.

---

## Self-review checklist

- [x] Spec coverage: every design decision in the "plan it out" brief is reflected in a task (open schema → Task 1; side-effect → Task 3; dedicated pass → Tasks 4, 5; docs / reviewer → Tasks 6, 7).
- [x] Placeholder scan: no "TBD" / "fill in" / vague-tests. All code and prose is literal.
- [x] Type / signature consistency: `properties: { [key]: scalar | null }` is used identically in Tasks 1, 3, 4, 5, 6. The Phase D.5 merge is "additive on the `properties` object" everywhere that ordering matters.
- [x] No references to methods/types that aren't defined in any task.
- [x] Every code block shows complete content or explicit before/after; no "similar to Task N" shortcuts.
