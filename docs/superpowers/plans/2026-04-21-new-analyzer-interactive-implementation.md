# `/new-analyzer` Interactive Scaffolder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the user-authored `config.json` input to `/new-analyzer` with an interactive, inference-driven flow that produces a thick scaffold (including a draft `rules.md` via the `rule-author` subagent), per `docs/superpowers/specs/2026-04-21-new-analyzer-interactive-design.md`.

**Architecture:** `stamp.mjs` becomes a generic substitution engine fed by a config object built entirely by `/new-analyzer` (no user-authored file). `rules.md.tmpl` is deleted — `/new-analyzer` writes `rules.md` directly after dispatching the `rule-author` agent in a new `MODE: dispatch`. Templates gain substitution tokens for language/frameworks/source-roots/manifest-list/identity-convention/phase-C hint/target question, replacing the `*fill in for your domain*` placeholders. Breaking change: v0.2.0, no backward compatibility shim.

**Tech Stack:** Node 20+ ESM, `node:test`, `node:assert/strict`, `ajv` + `ajv-formats` for schema validation in tests. No external test frameworks.

---

## Reference spec

All design decisions are in `docs/superpowers/specs/2026-04-21-new-analyzer-interactive-design.md`. Consult it for rationale whenever a task feels underspecified.

## File structure map

### Modified
- `plugins/agentic-analyzer/_core/bin/stamp.mjs` — drop `emittable_rule_ids`, add new required keys (`rule_ids`, `language`, `frameworks`, `source_roots`, `manifest_list`, `target_question`), add optional keys with defaults (`identity_convention`, `phase_c_hint`), add new substitution tokens.
- `plugins/agentic-analyzer/_core/bin/stamp.test.mjs` — update fixtures, add tests for new validation and substitutions.
- `plugins/agentic-analyzer/_core/bin/scaffold-e2e.test.mjs` — update fixtures, remove `rules.md` from expected files, delete the obsolete rules-content test.
- `plugins/agentic-analyzer/_core/templates/prompts/discovery.md.tmpl` — substitute tokens in place of `*fill in*` placeholders.
- `plugins/agentic-analyzer/_core/templates/SKILL.md.tmpl` — prepend `{{TARGET_QUESTION}}` to description.
- `plugins/agentic-analyzer/agents/rule-author.md` — add `§ Dispatch mode` + JSON envelope output spec + `rules_md` structure spec, wrap existing process under `§ Interactive mode (default)`.
- `plugins/agentic-analyzer/commands/new-analyzer.md` — full rewrite: new frontmatter, 7-step interactive flow, per-language lookup table.
- `CHANGELOG.md` — v0.2.0 breaking-change entry.
- `README.md` — replace config-handing example with the new workflow.
- `plugins/agentic-analyzer/README.md` — same update.

### Deleted
- `plugins/agentic-analyzer/_core/templates/rules.md.tmpl`
- `examples/logging-config.json`

### Unchanged but verified
- `plugins/agentic-analyzer/_core/templates/prompts/classification.md.tmpl`
- `plugins/agentic-analyzer/_core/templates/schema/*.json.tmpl`
- `plugins/agentic-analyzer/_core/templates/package.json.tmpl`
- `docs/INSTALL.md` — verify no references to the old config-handing flow.

### Deferred (manual)
- `examples/analyze-logging/` — regenerate by running the new `/new-analyzer` against a sample target. Deferred to a post-plan session; see Task 14.

---

## Task 1: Update test fixtures with new required keys (no stamp changes)

Current fixtures carry `emittable_rule_ids` and lack the new required keys. Updating them first is a no-op against the current stamp (extra keys are ignored). Removing `emittable_rule_ids` here intentionally breaks the suite to prove Task 2 fixes it.

**Files:**
- Modify: `plugins/agentic-analyzer/_core/bin/stamp.test.mjs:16-34`
- Modify: `plugins/agentic-analyzer/_core/bin/scaffold-e2e.test.mjs:16-34`

- [ ] **Step 1: Replace `CACHES_CONFIG` and `LOGGING_CONFIG` in `stamp.test.mjs` (lines 16-34)**

    const CACHES_CONFIG = {
      analyzer_name: "caches",
      entity_name_human: "Cache",
      entity_key: "caches",
      id_field: "cache_id",
      target_const: "multi-replica-openshift",
      decision_enum: ["retain", "externalize", "remove"],
      rule_ids: ["R1","R2","R3","R4","R5","R6","R7","R8a","R8b","R9a","R9b","R10","R11"],
      language: "java",
      frameworks: ["caffeine", "ehcache", "redis"],
      source_roots: ["src/main/java"],
      manifest_list: ["pom.xml", "build.gradle", "build.gradle.kts"],
      target_question: "Is this cache safe on multi-replica OpenShift?"
    };

    const LOGGING_CONFIG = {
      analyzer_name: "logging",
      entity_name_human: "Log call-site",
      entity_key: "entries",
      id_field: "call_site_id",
      target_const: "pii-regulated",
      decision_enum: ["allow", "redact", "remove"],
      rule_ids: ["L1","L2","L3","L4"],
      language: "java",
      frameworks: ["slf4j", "logback"],
      source_roots: ["src/main/java"],
      manifest_list: ["pom.xml", "build.gradle", "build.gradle.kts"],
      target_question: "Should this log call be allowed under PII rules?"
    };

- [ ] **Step 2: Paste the same two constants into `scaffold-e2e.test.mjs:16-34`**

- [ ] **Step 3: Run the test suite to confirm the expected break**

    cd plugins/agentic-analyzer/_core && npm test

Expected: tests FAIL with `config missing: emittable_rule_ids`. That's the cue that fixtures are updated and stamp.mjs is the next target. Do NOT commit yet — Task 2 fixes stamp.mjs and commits both together.

---

## Task 2: `stamp.mjs` — rename `emittable_rule_ids` → `rule_ids`

**Files:**
- Modify: `plugins/agentic-analyzer/_core/bin/stamp.mjs:13-22, 52-53, 66-68, 100-101`

- [ ] **Step 1: Update the config-shape comment (lines 13-22)**

Replace the `"emittable_rule_ids"` line with:

    //     "rule_ids":             ["R1","R2", ... ,"R11"]

- [ ] **Step 2: Update the `required` array (line 52-53)**

    const required = ["analyzer_name", "entity_name_human", "entity_key", "id_field",
                      "target_const", "decision_enum", "rule_ids"];

- [ ] **Step 3: Update the array validation block (lines 66-68)**

    if (!Array.isArray(config.rule_ids) || config.rule_ids.length === 0
        || !config.rule_ids.every(v => typeof v === "string" && v.length > 0)) {
      stderr.write("rule_ids must be a non-empty array of non-empty strings\n"); exit(1);
    }

- [ ] **Step 4: Update the substitution block (lines 100-101)**

    RULE_IDS:               enumList(config.rule_ids),
    RULE_IDS_WITH_NONE:     enumList([...config.rule_ids, "none"]),

- [ ] **Step 5: Run the test suite**

    cd plugins/agentic-analyzer/_core && npm test

Expected: all existing tests PASS. Fixtures and stamp.mjs are aligned.

- [ ] **Step 6: Commit (includes Task 1 fixture updates)**

    git add plugins/agentic-analyzer/_core/bin/stamp.mjs plugins/agentic-analyzer/_core/bin/stamp.test.mjs plugins/agentic-analyzer/_core/bin/scaffold-e2e.test.mjs
    git commit -m "refactor(stamp): rename emittable_rule_ids to rule_ids"

Body of the commit message (paste into the editor if your harness opens one):

    The field is now populated by /new-analyzer from the rule IDs extracted
    from the drafted rules.md, not by the user at scaffold time. No behaviour
    change beyond the rename.

    Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>

---

## Task 3: `stamp.mjs` — add new required keys (TDD)

New required keys: `language`, `frameworks`, `source_roots`, `manifest_list`, `target_question`.

**Files:**
- Modify: `plugins/agentic-analyzer/_core/bin/stamp.test.mjs`
- Modify: `plugins/agentic-analyzer/_core/bin/stamp.mjs`

- [ ] **Step 1: Append two failing tests to `stamp.test.mjs`**

    test("stamp: each new required key fails when omitted", () => {
      const base = { ...LOGGING_CONFIG };
      for (const key of ["language", "frameworks", "source_roots", "manifest_list", "target_question"]) {
        const dir = tmp();
        try {
          const cfg = join(dir, "config.json");
          const tdir = join(dir, "templates");
          const out = join(dir, "out");
          mkdirSync(tdir, { recursive: true });
          const broken = { ...base };
          delete broken[key];
          writeFileSync(cfg, JSON.stringify(broken));
          writeFileSync(join(tdir, "noop.tmpl"), "hi");
          const r = run([`--config=${cfg}`, `--templates=${tdir}`, `--out=${out}`]);
          assert.notEqual(r.status, 0, `omitting ${key} should fail`);
          assert.match(r.stderr, new RegExp(`config missing: ${key}`), `stderr: ${r.stderr}`);
        } finally { cleanup(dir); }
      }
    });

    test("stamp: new array/string keys fail when empty or malformed", () => {
      const cases = [
        { key: "frameworks",      bad: "not-an-array", expect: /frameworks must be an array/ },
        { key: "source_roots",    bad: [],             expect: /source_roots must be a non-empty array/ },
        { key: "source_roots",    bad: [""],           expect: /source_roots must be a non-empty array of non-empty strings/ },
        { key: "manifest_list",   bad: [],             expect: /manifest_list must be a non-empty array/ },
        { key: "manifest_list",   bad: [42],           expect: /manifest_list must be a non-empty array of non-empty strings/ },
        { key: "language",        bad: "Java",         expect: /language must match/ },
        { key: "target_question", bad: "",             expect: /target_question must be a non-empty string/ }
      ];
      for (const c of cases) {
        const dir = tmp();
        try {
          const cfg = join(dir, "config.json");
          const tdir = join(dir, "templates");
          const out = join(dir, "out");
          mkdirSync(tdir, { recursive: true });
          writeFileSync(cfg, JSON.stringify({ ...LOGGING_CONFIG, [c.key]: c.bad }));
          writeFileSync(join(tdir, "noop.tmpl"), "hi");
          const r = run([`--config=${cfg}`, `--templates=${tdir}`, `--out=${out}`]);
          assert.notEqual(r.status, 0, `${c.key}=${JSON.stringify(c.bad)} should fail`);
          assert.match(r.stderr, c.expect, `stderr: ${r.stderr}`);
        } finally { cleanup(dir); }
      }
    });

- [ ] **Step 2: Run to verify the new tests FAIL**

    cd plugins/agentic-analyzer/_core && node --test bin/stamp.test.mjs

Expected: the two new tests fail (stamp ignores these keys).

- [ ] **Step 3: Extend the `required` array in `stamp.mjs:52-53`**

    const required = ["analyzer_name", "entity_name_human", "entity_key", "id_field",
                      "target_const", "decision_enum", "rule_ids",
                      "language", "frameworks", "source_roots", "manifest_list",
                      "target_question"];

- [ ] **Step 4: Add validation after the `rule_ids` validation block**

    if (typeof config.language !== "string" || !/^[a-z][a-z0-9+-]*$/.test(config.language)) {
      stderr.write("language must match /^[a-z][a-z0-9+-]*$/\n"); exit(1);
    }
    if (!Array.isArray(config.frameworks)) {
      stderr.write("frameworks must be an array of strings\n"); exit(1);
    }
    if (!config.frameworks.every(v => typeof v === "string" && v.length > 0)) {
      stderr.write("frameworks must be an array of non-empty strings\n"); exit(1);
    }
    if (!Array.isArray(config.source_roots) || config.source_roots.length === 0) {
      stderr.write("source_roots must be a non-empty array\n"); exit(1);
    }
    if (!config.source_roots.every(v => typeof v === "string" && v.length > 0)) {
      stderr.write("source_roots must be a non-empty array of non-empty strings\n"); exit(1);
    }
    if (!Array.isArray(config.manifest_list) || config.manifest_list.length === 0) {
      stderr.write("manifest_list must be a non-empty array\n"); exit(1);
    }
    if (!config.manifest_list.every(v => typeof v === "string" && v.length > 0)) {
      stderr.write("manifest_list must be a non-empty array of non-empty strings\n"); exit(1);
    }
    if (typeof config.target_question !== "string" || config.target_question.length === 0) {
      stderr.write("target_question must be a non-empty string\n"); exit(1);
    }

- [ ] **Step 5: Run the full suite**

    cd plugins/agentic-analyzer/_core && npm test

Expected: all tests PASS.

- [ ] **Step 6: Commit**

    git add plugins/agentic-analyzer/_core/bin/stamp.mjs plugins/agentic-analyzer/_core/bin/stamp.test.mjs
    git commit -m "feat(stamp): require language, frameworks, source_roots, manifest_list, target_question"

---

## Task 4: `stamp.mjs` — optional `identity_convention` and `phase_c_hint` with defaults (TDD)

**Files:**
- Modify: `plugins/agentic-analyzer/_core/bin/stamp.test.mjs`
- Modify: `plugins/agentic-analyzer/_core/bin/stamp.mjs`

- [ ] **Step 1: Append failing tests**

    test("stamp: identity_convention defaults when omitted", () => {
      const tpl = `convention: {{IDENTITY_CONVENTION}}`;
      const dir = tmp();
      try {
        const cfg = join(dir, "config.json");
        const tdir = join(dir, "templates");
        const out = join(dir, "out");
        mkdirSync(tdir, { recursive: true });
        writeFileSync(cfg, JSON.stringify(LOGGING_CONFIG));
        writeFileSync(join(tdir, "x.md.tmpl"), tpl);
        const r = run([`--config=${cfg}`, `--templates=${tdir}`, `--out=${out}`]);
        assert.equal(r.status, 0, r.stderr);
        const content = readFileSync(join(out, "x.md"), "utf8");
        assert.match(content, /<lang>:<rel>:<class>\.<method>:<name>/);
      } finally { cleanup(dir); }
    });

    test("stamp: identity_convention honours an explicit value", () => {
      const tpl = `convention: {{IDENTITY_CONVENTION}}`;
      const dir = tmp();
      try {
        const cfg = join(dir, "config.json");
        const tdir = join(dir, "templates");
        const out = join(dir, "out");
        mkdirSync(tdir, { recursive: true });
        writeFileSync(cfg, JSON.stringify({ ...LOGGING_CONFIG, identity_convention: "py:<rel>:<module>.<func>" }));
        writeFileSync(join(tdir, "x.md.tmpl"), tpl);
        const r = run([`--config=${cfg}`, `--templates=${tdir}`, `--out=${out}`]);
        assert.equal(r.status, 0, r.stderr);
        const content = readFileSync(join(out, "x.md"), "utf8");
        assert.match(content, /py:<rel>:<module>\.<func>/);
      } finally { cleanup(dir); }
    });

    test("stamp: phase_c_hint defaults when omitted", () => {
      const tpl = `hint: {{PHASE_C_HINT}}`;
      const dir = tmp();
      try {
        const cfg = join(dir, "config.json");
        const tdir = join(dir, "templates");
        const out = join(dir, "out");
        mkdirSync(tdir, { recursive: true });
        writeFileSync(cfg, JSON.stringify(LOGGING_CONFIG));
        writeFileSync(join(tdir, "x.md.tmpl"), tpl);
        const r = run([`--config=${cfg}`, `--templates=${tdir}`, `--out=${out}`]);
        assert.equal(r.status, 0, r.stderr);
        const content = readFileSync(join(out, "x.md"), "utf8");
        assert.match(content, /no config-driven candidates detected/i);
      } finally { cleanup(dir); }
    });

- [ ] **Step 2: Run to verify the three new tests FAIL**

    cd plugins/agentic-analyzer/_core && node --test bin/stamp.test.mjs

Expected: failures from `unknown placeholder: {{IDENTITY_CONVENTION}}` / `{{PHASE_C_HINT}}`.

- [ ] **Step 3: In `stamp.mjs`, after the `requires_context7` default block (around line 61), add**

    if (config.identity_convention === undefined) {
      config.identity_convention = "<lang>:<rel>:<class>.<method>:<name>";
    }
    if (typeof config.identity_convention !== "string" || config.identity_convention.length === 0) {
      stderr.write("identity_convention must be a non-empty string\n"); exit(1);
    }
    if (config.phase_c_hint === undefined) {
      config.phase_c_hint = "No config-driven candidates detected at scaffold time. Delete this section if your domain has no ad-hoc or config-driven candidates; otherwise fill in what to correlate.";
    }
    if (typeof config.phase_c_hint !== "string") {
      stderr.write("phase_c_hint must be a string\n"); exit(1);
    }

- [ ] **Step 4: Register the tokens in the `substitutions` object (around line 92-104)**

Add to the object (keep existing entries):

    IDENTITY_CONVENTION:    config.identity_convention,
    PHASE_C_HINT:           config.phase_c_hint,

- [ ] **Step 5: Run the full suite**

    cd plugins/agentic-analyzer/_core && npm test

Expected: PASS.

- [ ] **Step 6: Commit**

    git add plugins/agentic-analyzer/_core/bin/stamp.mjs plugins/agentic-analyzer/_core/bin/stamp.test.mjs
    git commit -m "feat(stamp): add optional identity_convention and phase_c_hint with defaults"

---

## Task 5: `stamp.mjs` — remaining substitution tokens (TDD)

Add `{{LANGUAGE}}`, `{{FRAMEWORK_LIST}}`, `{{FRAMEWORK_REGEX}}`, `{{MANIFEST_LIST}}`, `{{SOURCE_ROOTS}}`, `{{TARGET_QUESTION}}`.

**Files:**
- Modify: `plugins/agentic-analyzer/_core/bin/stamp.test.mjs`
- Modify: `plugins/agentic-analyzer/_core/bin/stamp.mjs`

- [ ] **Step 1: Append failing tests**

    test("stamp: language/framework/manifest/source-root/target-question tokens substitute", () => {
      const tpl = [
        "language: {{LANGUAGE}}",
        "frameworks: [{{FRAMEWORK_LIST}}]",
        "regex: {{FRAMEWORK_REGEX}}",
        "manifests: [{{MANIFEST_LIST}}]",
        "source_roots: [{{SOURCE_ROOTS}}]",
        "question: {{TARGET_QUESTION}}"
      ].join("\n");
      const dir = tmp();
      try {
        const cfg = join(dir, "config.json");
        const tdir = join(dir, "templates");
        const out = join(dir, "out");
        mkdirSync(tdir, { recursive: true });
        writeFileSync(cfg, JSON.stringify(LOGGING_CONFIG));
        writeFileSync(join(tdir, "x.md.tmpl"), tpl);
        const r = run([`--config=${cfg}`, `--templates=${tdir}`, `--out=${out}`]);
        assert.equal(r.status, 0, r.stderr);
        const content = readFileSync(join(out, "x.md"), "utf8");
        assert.match(content, /language: java/);
        assert.match(content, /frameworks: \["slf4j", "logback"\]/);
        assert.match(content, /regex: \/\(slf4j\|logback\)\/i/);
        assert.match(content, /manifests: \["pom\.xml", "build\.gradle", "build\.gradle\.kts"\]/);
        assert.match(content, /source_roots: \["src\/main\/java"\]/);
        assert.match(content, /question: Should this log call be allowed under PII rules\?/);
      } finally { cleanup(dir); }
    });

    test("stamp: framework_regex emits a never-matching regex for an empty list", () => {
      const tpl = `regex: {{FRAMEWORK_REGEX}}`;
      const dir = tmp();
      try {
        const cfg = join(dir, "config.json");
        const tdir = join(dir, "templates");
        const out = join(dir, "out");
        mkdirSync(tdir, { recursive: true });
        writeFileSync(cfg, JSON.stringify({ ...LOGGING_CONFIG, frameworks: [] }));
        writeFileSync(join(tdir, "x.md.tmpl"), tpl);
        const r = run([`--config=${cfg}`, `--templates=${tdir}`, `--out=${out}`]);
        assert.equal(r.status, 0, r.stderr);
        const content = readFileSync(join(out, "x.md"), "utf8");
        assert.match(content, /regex: \/\(\?!\)\/i/, content);
      } finally { cleanup(dir); }
    });

- [ ] **Step 2: Run to verify the new tests FAIL**

    cd plugins/agentic-analyzer/_core && node --test bin/stamp.test.mjs

Expected: `unknown placeholder: {{LANGUAGE}}` on first failure.

- [ ] **Step 3: Add the `frameworkRegex` helper in `stamp.mjs` (right after `enumList`, around line 82)**

    const frameworkRegex = (frameworks) => {
      if (!frameworks.length) return "/(?!)/i";
      const alternation = frameworks.map(f => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
      return `/(${alternation})/i`;
    };

- [ ] **Step 4: Extend the `substitutions` object in `stamp.mjs` to its final form**

    const substitutions = {
      ANALYZER_NAME:          config.analyzer_name,
      ENTITY_NAME_HUMAN:      config.entity_name_human,
      ENTITY_KEY:             config.entity_key,
      ID_FIELD:               config.id_field,
      TARGET_CONST:           config.target_const,
      DECISION_ENUM_NO_NULL:  enumList(config.decision_enum),
      DECISION_ENUM_WITH_NULL:enumList(config.decision_enum, { withNull: true }),
      RULE_IDS:               enumList(config.rule_ids),
      RULE_IDS_WITH_NONE:     enumList([...config.rule_ids, "none"]),
      SERENA_PREREQ:          config.requires_serena   ? SERENA_HARD : SERENA_SOFT,
      CONTEXT7_PREREQ:        config.requires_context7 ? CTX7_HARD   : CTX7_SOFT,
      LANGUAGE:               config.language,
      FRAMEWORK_LIST:         enumList(config.frameworks),
      FRAMEWORK_REGEX:        frameworkRegex(config.frameworks),
      MANIFEST_LIST:          enumList(config.manifest_list),
      SOURCE_ROOTS:           enumList(config.source_roots),
      TARGET_QUESTION:        config.target_question,
      IDENTITY_CONVENTION:    config.identity_convention,
      PHASE_C_HINT:           config.phase_c_hint
    };

- [ ] **Step 5: Run the full suite**

    cd plugins/agentic-analyzer/_core && npm test

Expected: PASS.

- [ ] **Step 6: Commit**

    git add plugins/agentic-analyzer/_core/bin/stamp.mjs plugins/agentic-analyzer/_core/bin/stamp.test.mjs
    git commit -m "feat(stamp): add LANGUAGE/FRAMEWORK_LIST/FRAMEWORK_REGEX/MANIFEST_LIST/SOURCE_ROOTS/TARGET_QUESTION tokens"

---

## Task 6: Delete `rules.md.tmpl`, update e2e tests

**Files:**
- Delete: `plugins/agentic-analyzer/_core/templates/rules.md.tmpl`
- Modify: `plugins/agentic-analyzer/_core/bin/scaffold-e2e.test.mjs`

- [ ] **Step 1: Delete the template**

    rm plugins/agentic-analyzer/_core/templates/rules.md.tmpl

- [ ] **Step 2: Edit the "e2e: full scaffold…" test in `scaffold-e2e.test.mjs`**

Remove `"rules.md"` from the list passed to the `for (const f of [...])` loop. After editing, that list reads exactly:

    for (const f of [
      "SKILL.md",
      "prompts/discovery.md",
      "prompts/classification.md",
      "schema/analysis.schema.json",
      "schema/candidates.schema.json",
      "schema/coverage.schema.json",
      "schema/overrides.schema.json",
      "package.json"
    ]) {

- [ ] **Step 3: Right after the existence loop in that same test, add**

    assert.ok(!existsSync(join(out, "rules.md")),
      "rules.md must NOT be produced by stamp (it is written by /new-analyzer)");

- [ ] **Step 4: Delete the obsolete test block**

Remove the entire test starting at `test("e2e: rules.md mentions the analyzer's decision set", ...` (originally lines 81-90 of `scaffold-e2e.test.mjs`).

- [ ] **Step 5: Run the e2e suite**

    cd plugins/agentic-analyzer/_core && node --test bin/scaffold-e2e.test.mjs

Expected: PASS.

- [ ] **Step 6: Run the full suite**

    cd plugins/agentic-analyzer/_core && npm test

Expected: PASS.

- [ ] **Step 7: Commit**

    git add plugins/agentic-analyzer/_core/templates/rules.md.tmpl plugins/agentic-analyzer/_core/bin/scaffold-e2e.test.mjs
    git commit -m "refactor: stamp no longer produces rules.md (written by /new-analyzer)"

---

## Task 7: `discovery.md.tmpl` — substitute tokens

**Files:**
- Modify: `plugins/agentic-analyzer/_core/templates/prompts/discovery.md.tmpl`

- [ ] **Step 1: Replace the Phase A intro + steps 1-3 (current lines 18-26)**

    ## Phase A — Framework survey (uses Context7)

    The declared frameworks for this analyzer are `[{{FRAMEWORK_LIST}}]`. Phase A
    walks the target repo's build manifests, confirms which of these are in scope
    for the current repo, and pulls their {{ENTITY_NAME_HUMAN}} surfaces from
    Context7.

    1. List every build manifest in the target repo matching
       `[{{MANIFEST_LIST}}]`, restricted to source roots `[{{SOURCE_ROOTS}}]`.
    2. Extract all declared dependencies from those manifests.
    3. Apply the fast-path coordinate regex `{{FRAMEWORK_REGEX}}` to pre-filter.

Keep the rest of Phase A (steps 4-6: Context7 lookup, degradations, frameworks[]) unchanged.

- [ ] **Step 2: Replace the Phase B identity convention paragraph (around current lines 80-85)**

    ### Identity convention for `{{ID_FIELD}}`

    The ID must be stable across runs for the same source construct. For this
    analyzer: `{{IDENTITY_CONVENTION}}`. The override engine relies on this
    convention; changing it invalidates all existing overrides.

- [ ] **Step 3: Replace the Phase C section header + intro**

    ## Phase C — Ad-hoc + config correlation

    {{PHASE_C_HINT}}

    If this analyzer has config-driven or ad-hoc candidates, describe:

    - What "ad-hoc" means in your domain (e.g., bare `HashMap` fields, plain
      `System.out.println`, environment-variable reads).
    - The shape gate that separates real candidates from false positives.
    - How config files are parsed and correlated with symbolic candidates.
    - Redaction rules for secret-like values.

    Merge by identity: if a Phase C candidate has the same `{{ID_FIELD}}` as a
    Phase B candidate, keep Phase B and discard the Phase C duplicate (but
    preserve the Phase C `config_refs[]` on the surviving entry if you model
    that).

- [ ] **Step 4: Run the e2e suite**

    cd plugins/agentic-analyzer/_core && node --test bin/scaffold-e2e.test.mjs

Expected: PASS. The "e2e: discovery prompt uses the scaffolded id field" assertion (no `{{…}}` remaining) catches any missed token.

- [ ] **Step 5: Commit**

    git add plugins/agentic-analyzer/_core/templates/prompts/discovery.md.tmpl
    git commit -m "refactor(templates): substitute domain values into discovery.md at stamp time"

---

## Task 8: `SKILL.md.tmpl` — prepend target question to description

**Files:**
- Modify: `plugins/agentic-analyzer/_core/templates/SKILL.md.tmpl:3`

- [ ] **Step 1: Edit the `description:` frontmatter line (line 3)**

Replace with:

    description: Answers the question "{{TARGET_QUESTION}}" by discovering, classifying, and inventorying every {{ENTITY_NAME_HUMAN}} in a target repository. Produces a schema-validated JSON inventory labeling each entry against a versioned ruleset, assuming target `{{TARGET_CONST}}`. Only invoke when the user explicitly requests {{ANALYZER_NAME}} analysis, inventory, or review.

- [ ] **Step 2: Run the e2e suite**

    cd plugins/agentic-analyzer/_core && node --test bin/scaffold-e2e.test.mjs

Expected: PASS (the "SKILL.md has placeholders fully resolved" test asserts no unresolved tokens).

- [ ] **Step 3: Commit**

    git add plugins/agentic-analyzer/_core/templates/SKILL.md.tmpl
    git commit -m "feat(templates): embed target question in SKILL.md description"

---

## Task 9: `agents/rule-author.md` — add dispatch mode

**Files:**
- Modify: `plugins/agentic-analyzer/agents/rule-author.md`

- [ ] **Step 1: Wrap the existing process section**

Find `## Your process` (around line 22) and rename it to:

    ## Interactive mode (default)

    Use this flow when a human invokes rule-author directly after scaffolding.

Keep the numbered steps unchanged beneath the new header.

- [ ] **Step 2: Insert a new Dispatch mode section BEFORE the `## Shapes that work well` section**

    ## Dispatch mode

    When your prompt opens with `MODE: dispatch`, you were invoked by
    `/new-analyzer` during initial scaffolding. Do NOT ask the user any
    questions. Apply the interactive playbook's logic to the inputs provided
    and return a JSON envelope.

    ### Input brief shape

    The dispatching prompt supplies these keys:

    - `target_question` — one-sentence target question
    - `entity_name_human`, `entity_key`, `id_field` — naming
    - `decision_enum` — closed decision set
    - `target_const` — deployment-context label
    - `language`, `frameworks`, `source_roots` — repo grounding

    ### Output envelope

    Return ONLY this JSON object, no surrounding prose:

        {
          "ruleset_version": "<today YYYY-MM-DD>",
          "rules_md":        "<full markdown content of rules.md>",
          "rule_ids":        ["R0", "R1", "..."],
          "uncertainties":   [{ "topic": "...", "question": "...", "why": "..." }]
        }

    `rule_ids` must equal the set of IDs in the `rules_md` rule-labels table.
    Disagreement between the two is a hard error downstream.

    ### `rules_md` structure

    Exactly these sections, in order:

    1. Title — `# <entity_name_human> Classification Rules`
    2. Version + target lines:
       - `**Version:** ruleset_version: "YYYY-MM-DD"`
       - `**Target (fixed):** <target_const>.`
    3. One-sentence intro stating "Apply rules in evaluation order; first rule
       that fires decides."
    4. Valid rule IDs — prose sentence listing the stamped enum.
    5. Rule labels — a markdown table with columns `ID | Rule | Decision`.
       One row per entry in `rule_ids`. Decisions are drawn from
       `decision_enum`, or the word `dropped` for a drop rule, or
       `needs_review` for the catch-all.
    6. Evaluation order — numbered list describing order (not numerical).
    7. Confidence — three-bullet section for high / medium / low.

    ### Default ruleset shape

    When inputs don't contradict it, default to:

    - Drop rule at R0 when candidate discovery is loose. Skip R0 when the
      candidate space is tight.
    - 1-2 happy-path rules per decision in `decision_enum`.
    - Catch-all at R_last → `decision: null`, `analysis_status:
      "needs_review"`, `confidence: "low"`.

    Deviate only with a matching `uncertainties[]` entry that justifies the
    deviation.

    ### Uncertainty honesty

    Emit one `uncertainties[]` entry per genuine ambiguity you could not
    resolve from the brief alone. Empty `uncertainties[]` is a strong claim
    of confidence — do not make it falsely. Favour a short, targeted
    uncertainty question over a silent guess.

- [ ] **Step 3: Commit**

    git add plugins/agentic-analyzer/agents/rule-author.md
    git commit -m "feat(rule-author): add dispatch mode for /new-analyzer invocation"

---

## Task 10: `commands/new-analyzer.md` — full rewrite

This is the largest edit. It's a prompt file, so there are no unit tests — validation is manual and end-to-end against a sample target later.

**Files:**
- Modify: `plugins/agentic-analyzer/commands/new-analyzer.md` (full rewrite)

- [ ] **Step 1: Replace the entire file with the following**

    ---
    name: new-analyzer
    description: Scaffold a new agentic-analyzer skill into the current project. Interviews the user for the target question, infers repo context, dispatches the rule-author subagent to draft rules.md, and stamps the templates into .claude/skills/analyze-<name>/. Zero user-authored config JSON required.
    argument-hint: "[target-root]"
    allowed-tools:
      - Read
      - Write
      - Edit
      - Glob
      - Grep
      - Task
      - Bash(node *)
      - Bash(cp *)
      - Bash(mkdir *)
      - Bash(test *)
      - Bash(ls *)
      - Bash(pwd *)
      - Bash(realpath *)
    ---

    You are the interactive scaffolder for the `agentic-analyzer` plugin. You
    turn a short user interview plus a read-only scan of a target repository
    into a populated `.claude/skills/analyze-<analyzer_name>/` directory with
    a drafted `rules.md` ready for iteration.

    Never ask the user to hand you a config JSON. Never invoke `stamp.mjs`
    without a complete internal config object built from the interview.

    ## Arguments

    - `$1` — target project root (optional; defaults to cwd). The scaffolded
      skill lands at `<target>/.claude/skills/analyze-<analyzer_name>/`.

    ## Per-language lookup table

    Use this table as the ground truth for manifest filenames, default source
    roots, and default identity-convention templates. When a language is
    detected or chosen, apply the corresponding row.

    | language | manifests | default source_roots | identity_convention |
    |---|---|---|---|
    | java | pom.xml, build.gradle, build.gradle.kts, settings.gradle | src/main/java | java:<rel>:<class>.<method>:<name> |
    | kotlin | build.gradle.kts, settings.gradle.kts, pom.xml | src/main/kotlin | kotlin:<rel>:<class>.<method>:<name> |
    | javascript | package.json | src, app | js:<rel>:<symbol>:<discriminator> |
    | typescript | package.json, tsconfig.json | src, app | ts:<rel>:<symbol>:<discriminator> |
    | python | pyproject.toml, requirements.txt, setup.py, Pipfile | src, <pkgname> | py:<rel>:<module>.<func>:<name> |
    | go | go.mod | cmd, pkg, internal | go:<rel>:<pkg>.<func>:<name> |
    | rust | Cargo.toml | src, crates | rust:<rel>:<module>::<fn>:<name> |
    | dotnet | *.csproj, *.fsproj, *.sln | src, . | dotnet:<rel>:<class>.<method>:<name> |
    | ruby | Gemfile | lib, app | ruby:<rel>:<module>.<method>:<name> |
    | php | composer.json | src | php:<rel>:<class>::<method>:<name> |
    | elixir | mix.exs | lib | ex:<rel>:<module>.<fun>:<name> |

    ## Steps

    ### Step 1 — Preflight scan (silent)

    Resolve the argument. Use `realpath` if available, else a Node one-liner.

        TARGET_ROOT=$(realpath "${1:-.}")
        PLUGIN_ROOT="$CLAUDE_PLUGIN_ROOT"

    If `PLUGIN_ROOT` is empty, abort: "launch Claude Code with the
    agentic-analyzer plugin installed." If `TARGET_ROOT` does not exist or
    is not readable, abort with the error.

    Scan (read-only) using Glob/Grep only. Collect:

    - **Primary language and full dep list.** For each manifest row in the
      lookup table, Glob for matches under `TARGET_ROOT`. Record every
      manifest found and its language. If multiple languages match, record
      all; the dominant one is whichever has the most file bytes in the
      standard source roots.
    - **Source roots in use.** For the winning language, which default
      source roots exist on disk? Record the subset.
    - **Repo layout.** Monorepo signals (`pnpm-workspace.yaml`,
      `lerna.json`, `turbo.json`, `nx.json`, Gradle multi-project,
      Cargo workspace).
    - **Deployment-context hints.** Presence of `Dockerfile`,
      `docker-compose*.yml`, `helm/`, `*.k8s.yaml`, `kustomization.yaml`,
      `serverless.yml`, `template.yml`, `terraform/*.tf`. Used as
      grounding in step 5, NOT as a proposal.
    - **Existing analyzers.** Glob for `.claude/skills/analyze-*`;
      record names for collision avoidance.

    If `TARGET_ROOT/.claude/skills/analyze-<name>` already exists for any
    `<name>` that would match the forthcoming interview, the post-naming
    step must abort cleanly (step 3).

    Ask NO questions yet.

    ### Step 2 — Open prompt: target question

    Say:

    > What's the target question this analyzer should answer? One sentence.
    > Examples: "Is this cache safe on multi-replica OpenShift?", "Should
    > this log call be allowed under PII rules?"

    Wait for the user's answer. That sentence is `target_question`.

    ### Step 3 — Confirmation batch 1: Naming

    Derive candidates from `target_question` + the existing analyzers list:

    - `analyzer_name`: kebab/snake-case slug from the entity in the target
      question (e.g., "log call-site" → `logging`). If that collides with
      an existing analyzer, suggest a suffix (`logging-2`).
    - `entity_name_human`: a short noun phrase ("Log call-site", "Cache",
      "Feature flag").
    - `entity_key`: plural snake-case noun (`entries`, `caches`, `flags`).
    - `id_field`: singular snake-case with `_id` (`call_site_id`,
      `cache_id`, `flag_id`).

    Present them as a block and ask for confirmation or corrections:

    > I propose:
    >   analyzer_name:     logging
    >   entity_name_human: Log call-site
    >   entity_key:        entries
    >   id_field:          call_site_id
    >
    > Confirm, or reply with corrections (e.g., `entity_key: events`).

    If the user corrects any field, apply the edit and re-present. Do not
    proceed until the user confirms. If the final `analyzer_name` collides
    with an existing skill, abort with: "analyze-<name> already exists at
    <path> — delete it or choose another name."

    ### Step 4 — Confirmation batch 2: Repo context

    From the scan:

    - `language`: winning language key from the lookup table.
    - `source_roots`: the subset of the language's default source roots
      that exist on disk. If none exist, use the language defaults as-is.
    - **Framework subset relevant to this entity.** From the full dep list,
      pick the deps plausibly relevant to `entity_name_human`. This is
      judgment — e.g., for "Log call-site" keep slf4j/logback/log4j/winston/
      pino/zap/spdlog/etc.; discard ORMs, UI libraries, etc. If no deps
      look relevant, set `frameworks: []`.
    - `manifest_list`: the lookup-table manifest list for `language`.
    - Repo layout (single/monorepo): stated as grounding only.

    Present the block and ask for confirmation:

    > From scanning <target>:
    >   language:      java
    >   source_roots:  src/main/java
    >   frameworks:    slf4j, logback
    >   manifests:     pom.xml, build.gradle, build.gradle.kts
    >   layout:        single project
    >
    > Confirm, or reply with corrections.

    Apply corrections and re-present until confirmed. If the scan turned up
    empty, ask the user to supply each field explicitly.

    ### Step 5 — Confirmation batch 3: Decisions + target

    **Decisions.** Propose a `decision_enum` by entity-pattern lookup:

    - cache-like → `["retain", "externalize", "remove"]`
    - log-like → `["allow", "redact", "remove"]`
    - flag-like → `["keep", "inline", "remove"]`
    - unknown → ask open.

    Present with a "none of these → write your own" escape:

    > Decision set: ["allow", "redact", "remove"] — accept, or write your own.

    **Target.** Show the deployment-context scan as grounding, then ask:

    > I see: Dockerfile, helm/ (replicas=3 in values.yaml). What
    > target_const label fits? (e.g., multi-replica-openshift,
    > pii-regulated, serverless-aws-lambda)

    `target_const` is a free-form string — accept whatever the user writes.

    ### Step 6 — Dispatch rule-author subagent

    Use the `Task` tool with subagent_type `rule-author`. Prompt:

        MODE: dispatch
        You were invoked by /new-analyzer to produce an initial rules.md draft.
        Do NOT ask the user any questions. Apply your authoring playbook to
        the inputs below and return the JSON envelope specified in your
        agent definition.

        INPUTS:
        - target_question:    "<from Step 2>"
        - entity_name_human:  "<from Step 3>"
        - entity_key:         "<from Step 3>"
        - id_field:           "<from Step 3>"
        - decision_enum:      <from Step 5, as JSON array>
        - target_const:       "<from Step 5>"
        - language:           "<from Step 4>"
        - frameworks:         <from Step 4, as JSON array>
        - source_roots:       <from Step 4, as JSON array>

        Return ONLY the JSON envelope, no prose.

    Parse the returned JSON. If parsing fails or the envelope is malformed
    (missing keys, empty `rule_ids`, decisions outside `decision_enum`,
    `rule_ids` disagreeing with the table in `rules_md`), abort with the
    raw output and tell the user to re-run.

    Show the drafted `rules_md` to the user in a fenced markdown block.
    List `uncertainties[]` as numbered follow-up questions.

    For each uncertainty the user answers, edit the in-memory `rules_md`
    string directly using string replacement — do NOT re-dispatch the
    subagent.

    When the user confirms ("looks good" / "stamp it"), extract the
    `rule_ids` from the final `rules_md` table (they must match the
    envelope's `rule_ids` field — if they diverge after user edits, parse
    the table as authoritative).

    ### Step 7 — Stamp + write rules.md + summary

    Build the internal config object from everything collected:

        {
          "analyzer_name":      "...",
          "entity_name_human":  "...",
          "entity_key":         "...",
          "id_field":           "...",
          "target_const":       "...",
          "decision_enum":      [...],
          "rule_ids":           [...],
          "language":           "...",
          "frameworks":         [...],
          "source_roots":       [...],
          "manifest_list":      [...],
          "target_question":    "..."
        }

    Optional: include `identity_convention` if a non-default was chosen.
    Omit otherwise (stamp applies the default).

    Write the config to a temp file (e.g., a `config.json` in a tmp dir
    created by `mktemp -d` or Node equivalent). Run:

        SKILL_DIR="$TARGET_ROOT/.claude/skills/analyze-$ANALYZER_NAME"
        node "$PLUGIN_ROOT/_core/bin/stamp.mjs" \
          --config="$TMP_CONFIG" \
          --templates="$PLUGIN_ROOT/_core/templates" \
          --out="$SKILL_DIR"

    On non-zero exit: delete the tmp config, surface stderr, abort. The
    stamper cleans up its own staging dir on failure.

    After stamp succeeds, write `rules.md` directly using the `Write` tool:

        Write to $SKILL_DIR/rules.md with the resolved rules_md content.

    Copy runtime utilities verbatim (unchanged from the old command):

        mkdir -p "$SKILL_DIR/bin"
        cp "$PLUGIN_ROOT/_core/bin/_args.mjs"                   "$SKILL_DIR/bin/"
        cp "$PLUGIN_ROOT/_core/bin/validate.mjs"                "$SKILL_DIR/bin/"
        cp "$PLUGIN_ROOT/_core/bin/normalize.mjs"               "$SKILL_DIR/bin/"
        cp "$PLUGIN_ROOT/_core/bin/compare-fixture.mjs"         "$SKILL_DIR/bin/"
        cp "$PLUGIN_ROOT/_core/bin/replay-overrides.mjs"        "$SKILL_DIR/bin/"
        cp "$PLUGIN_ROOT/_core/bin/migrate-overrides-v1-v2.mjs" "$SKILL_DIR/bin/"
        cp "$PLUGIN_ROOT/_core/bin/fixture-init.mjs"            "$SKILL_DIR/bin/"

    Delete the tmp config.

    Print to the session:

        /new-analyzer complete

        Skill scaffolded at: $SKILL_DIR
        Target question:     <from Step 2>

        Silent defaults applied:
          requires_serena:       true
          requires_context7:     true
          identity_convention:   <from lookup table or user override>
          phase_c_hint:          <default>

        YOU HAVE ZERO FIXTURES.
        Invariant #11 (fixture harness) will fail until you run
        /fixture-author. Do that next.

        Other next steps:
          1. cd "$SKILL_DIR" && npm install
          2. Review rules.md — the rule-author drafted it, but rules
             benefit from author iteration.
          3. Run /schema-author only if rules need domain-specific fields.
          4. Run /analyze-$ANALYZER_NAME <repo-path> to try it.

    ## Hard rules

    - Never overwrite an existing skill dir. If `$SKILL_DIR` exists, abort.
    - Never write outside `$SKILL_DIR`.
    - Never proceed to `stamp.mjs` without a complete, validated config
      object built from the interview. If the user aborts mid-interview,
      exit cleanly with no scaffolded output.
    - Do not run `npm install` for the author.
    - Do not re-dispatch `rule-author` to handle uncertainties; resolve
      them via inline edits to the drafted `rules_md` in the main
      conversation.

- [ ] **Step 2: Smoke-test by reading the file back**

    Manually open `commands/new-analyzer.md` and confirm the frontmatter
    parses (no YAML syntax errors) and the per-language table renders.

- [ ] **Step 3: Commit**

    git add plugins/agentic-analyzer/commands/new-analyzer.md
    git commit -m "feat(new-analyzer): rewrite as interactive inference-driven scaffolder"

---

## Task 11: Delete `examples/logging-config.json`

**Files:**
- Delete: `examples/logging-config.json`

- [ ] **Step 1: Delete**

    rm examples/logging-config.json

- [ ] **Step 2: Commit**

    git add examples/logging-config.json
    git commit -m "chore(examples): drop obsolete logging-config.json (no more user-authored configs)"

---

## Task 12: `CHANGELOG.md` — v0.2.0 entry

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Insert a v0.2.0 entry at the top of the file**

Example shape (adapt to the existing CHANGELOG style — if the file uses Keep-a-Changelog headings, follow them):

    ## v0.2.0 — 2026-04-21

    ### Breaking
    - `/new-analyzer` no longer takes a `config.json` argument. Run it with
      an optional target-root path; it interviews you for the rest. Any
      existing `config.json` files are obsolete.
    - `stamp.mjs` required-key shape changed: `emittable_rule_ids` renamed
      to `rule_ids`; new required keys `language`, `frameworks`,
      `source_roots`, `manifest_list`, `target_question`.
    - `stamp.mjs` no longer produces `rules.md` — it's written directly by
      `/new-analyzer` after dispatching the `rule-author` agent.

    ### Added
    - `rule-author` agent gained a `MODE: dispatch` that returns a JSON
      envelope `{ ruleset_version, rules_md, rule_ids, uncertainties }`
      consumed by `/new-analyzer`.
    - New substitution tokens in templates: `{{LANGUAGE}}`,
      `{{FRAMEWORK_LIST}}`, `{{FRAMEWORK_REGEX}}`, `{{MANIFEST_LIST}}`,
      `{{SOURCE_ROOTS}}`, `{{TARGET_QUESTION}}`, `{{IDENTITY_CONVENTION}}`,
      `{{PHASE_C_HINT}}`.
    - `discovery.md.tmpl` Phase A/B/C now embed concrete values instead of
      `*fill in for your domain*` placeholders.

    ### Removed
    - `_core/templates/rules.md.tmpl`.
    - `examples/logging-config.json`.

- [ ] **Step 2: Commit**

    git add CHANGELOG.md
    git commit -m "docs(changelog): v0.2.0 — interactive /new-analyzer"

---

## Task 13: READMEs — replace the config example with the interactive workflow

**Files:**
- Modify: `README.md`
- Modify: `plugins/agentic-analyzer/README.md`

- [ ] **Step 1: In `README.md`, find any section showing a domain config JSON block and replace it with**

    ## Scaffolding a new analyzer

    Run `/new-analyzer` inside a Claude Code session with the target repo as
    the working directory (or pass its path as the first argument). The
    command interviews you:

    1. The target question (one sentence).
    2. Confirm derived naming (analyzer_name, entity, id_field).
    3. Confirm scanned repo context (language, source roots, frameworks).
    4. Pick a decision set and target_const.

    `/new-analyzer` then dispatches the `rule-author` agent to draft
    `rules.md`, surfaces any uncertainties it flagged, and stamps the
    skill at `.claude/skills/analyze-<name>/`.

    Next step after scaffolding is always `/fixture-author` — the scaffold
    ships with zero fixtures.

- [ ] **Step 2: Apply the same replacement in `plugins/agentic-analyzer/README.md`**

- [ ] **Step 3: Commit**

    git add README.md plugins/agentic-analyzer/README.md
    git commit -m "docs(readme): describe the interactive /new-analyzer workflow"

---

## Task 14: Verify INSTALL.md and close out

**Files:**
- Modify: `docs/INSTALL.md` (only if references are stale)

- [ ] **Step 1: Scan for stale references**

    cd C:/projects/agentic-analyzer && grep -n "config.json\|emittable_rule_ids" docs/INSTALL.md

- [ ] **Step 2: If matches are found, replace each with a reference to `/new-analyzer`'s interactive flow (see Task 13's snippet for phrasing). If no matches, skip to Step 3.**

- [ ] **Step 3 (if edited): Commit**

    git add docs/INSTALL.md
    git commit -m "docs(install): remove stale references to the old config.json workflow"

- [ ] **Step 4: Run the full test suite one last time**

    cd plugins/agentic-analyzer/_core && npm test

Expected: all tests PASS.

- [ ] **Step 5: Mark the example regeneration as a follow-up**

The `examples/analyze-logging/` directory was produced by the old flow. It
stays as-is for this plan — regenerating it requires running the new
`/new-analyzer` against a real target repo, which is a manual step
outside the TDD loop. Add a follow-up task note to the project's issue
tracker (or a TODO in the repo) saying "regenerate examples/analyze-logging
via `/new-analyzer`". No commit needed for this step.

---

## Self-review checklist (run after completing all tasks)

Before declaring the plan complete, verify:

1. **Spec coverage.** Every bullet in the spec's "Implementation surface"
   section maps to a task above. If something is missing, add a task.
2. **No placeholders.** Search all tasks for "TODO", "TBD", "fill in", or
   code blocks that describe an action without the actual code.
3. **Type consistency.** `rule_ids` (not `emittable_rule_ids`),
   `manifest_list` (not `manifest_filenames`), `target_question` (not
   `goal_question`) throughout. One word per concept.
4. **Test runner.** Every "Run the suite" step uses
   `cd plugins/agentic-analyzer/_core && npm test` or
   `node --test bin/stamp.test.mjs`. No other runners referenced.
5. **Commit cadence.** Each task ends with a commit. Task 1 intentionally
   breaks the build and commits with Task 2 — noted in the task body.

---

## Execution handoff

Plan complete. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task,
   review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using
   `superpowers:executing-plans`, batch execution with checkpoints.

Which approach?
