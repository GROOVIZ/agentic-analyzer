# `/new-analyzer` interactive scaffolder — design

**Date:** 2026-04-21
**Status:** Draft, pending user approval
**Target version:** v0.2.0 (breaking change)

## Problem

Today, `/new-analyzer` requires the user to hand-author a `config.json` containing
identity, decisions, and `emittable_rule_ids`. The command runs `stamp.mjs`,
which substitutes those values into templates that are otherwise full of
`*fill in for your domain*` placeholders. After scaffolding, the author still has
to write the ruleset, the discovery prompt, the framework regex, the identity
convention, and a fixture suite from scratch.

Two problems with the current shape:

1. **`emittable_rule_ids` is in the wrong place.** It's authored at scaffold time
   but the actual rules don't exist yet — the author hasn't written `rules.md`.
   Re-stamping after rules stabilize wipes hand-edits (`stamp.mjs:172-176`),
   making the field hostile to iteration.
2. **The scaffold is too thin.** Domain knowledge (language, frameworks, source
   roots, target question, decision signals) lives as `*fill in*` instructions
   that the author has to satisfy through four separate specialist agents post
   scaffold. The user does most of the work.

## Goals

- Eliminate the user-authored `config.json`. The only argument is the target
  repo path (defaults to cwd).
- Aggressively infer everything that's derivable from the target repo
  (language, frameworks, source roots, deployment-context hints, existing
  analyzer collisions). Confirm point-by-point.
- Ask the user only what's irreducibly human: the target question, the decision
  enum, the policy `target_const`, and any uncertainties the rule-author
  subagent flags.
- Produce a *thick* scaffold with a real `rules.md` drafted by the existing
  `rule-author` agent (in a new dispatch mode), so the analyzer is runnable
  end-to-end the moment the command finishes.
- Preserve the agentic nature of the runtime: scaffold artifacts capture domain
  *knowledge*, not procedure. Phase A/B/C/D execution remains agent-driven.

## Non-goals (deliberately deferred)

- **Fixtures.** Excluded from scaffold time. The scaffold summary loudly tells
  the user to run `/fixture-author` next; without fixtures, invariant #11 from
  `analyzer-reviewer` will fail. Fixture authoring stays domain-specific and
  human-driven.
- **Schema extensions.** `schema-author` remains a separate post-scaffold step.
- **Re-elicitation / `--reseed` mode.** A second run on an existing skill dir
  aborts cleanly. Iteration on an existing scaffold goes through the specialist
  agents (`rule-author`, `schema-author`, `fixture-author`) directly.
- **Backward compatibility.** Project is at v0.1.0 with one initial commit. The
  config shape changes hard at v0.2.0 with no shim, no `--legacy` flag.

## Design

### Architectural choices (decided during brainstorming)

1. **Thick scaffold, self-authoring** — `/new-analyzer` produces a runnable
   skeleton including a real `rules.md`, not just a shell.
2. **Aggressive inference, point-by-point confirmation** — Claude scans the repo
   silently first; every inferred field is shown to the user with a
   per-field correction path.
3. **Subagent dispatch with tweak** — `/new-analyzer` collects inputs and
   dispatches the existing `rule-author` agent in a new `MODE: dispatch` to
   produce the initial ruleset. If the user wants to revise, they edit inline
   in the main conversation; no re-dispatch.

### Overall flow

Seven steps inside the redesigned `/new-analyzer`:

1. **Preflight scan** (silent). Resolve `$1` → target repo (defaults to cwd).
   Read-only sweep:
   - Manifest files → primary language, full dependency list, build system.
   - Source-root conventions per language.
   - Repo layout (single vs monorepo signals: `pnpm-workspace.yaml`,
     `lerna.json`, `turbo.json`, `nx.json`, Gradle multi-project, Cargo
     workspace).
   - Deployment-context hints: `Dockerfile`, `docker-compose*`, `helm/`,
     `*.k8s.yaml`, `serverless.yml`, `terraform/`.
   - Existing `.claude/skills/analyze-*` for collision avoidance.

   If `$1` resolves to an existing scaffolded skill, abort cleanly:
   *"analyze-X already exists — delete it or use the specialist agents to
   edit."* No `--force`.

2. **Open prompt — target question.** *"What's the target question this
   analyzer should answer? One sentence."* The single load-bearing input.

3. **Confirmation batch 1 — Naming.** From target question + scan: derive
   `analyzer_name`, `entity_name_human`, `entity_key`, `id_field`. Shown
   together, each editable.

4. **Confirmation batch 2 — Repo context.** Primary language, source roots,
   repo layout, **framework subset relevant to the entity**. The framework
   filter is LLM judgment in the command body — Claude reads the full dep
   list (from preflight) plus the now-known entity domain (from the target
   question + naming) and proposes the relevant subset. There is no hardcoded
   entity→framework lookup in `stamp.mjs`. One round; user accepts or edits
   any field.

5. **Confirmation batch 3 — Decisions + target.**
   - `decision_enum`: proposed by **entity-pattern lookup** (cache →
     `retain/externalize/remove`; log → `allow/redact/remove`; flag →
     `keep/inline/remove`). Multi-choice with explicit "none of these → write
     your own" escape hatch.
   - `target_const`: asked outright. The deployment-context scan is shown as
     *grounding* ("I see Helm + replicas=3, what target label fits?"), not as a
     proposal. User writes a free-form policy string.

6. **Dispatch `rule-author` subagent.** Build a self-contained brief from
   everything collected. Subagent returns
   `{ ruleset_version, rules_md, rule_ids, uncertainties[] }`.
   `/new-analyzer` shows the drafted `rules.md` and surfaces uncertainties as
   targeted follow-ups; user answers, Claude in the main conversation edits the
   in-memory `rules_md` string inline. No re-dispatch.

7. **Stamp + summary.** Build the internal config object, pass to `stamp.mjs`.
   Write the final `rules.md` directly from the resolved `rules_md` string
   (stamp no longer produces it). Print scaffolded paths and a **loud**
   handoff:

   > *"Scaffolded at `<path>`. You have zero fixtures — invariant #11 will
   > fail until you run `/fixture-author`. Run `/schema-author` only if rules
   > need domain-specific fields. Then `/analyze-<name>` to try it."*

   Also surface silent defaults applied: `requires_serena: true`,
   `requires_context7: true`, identity convention
   `<lang>:<rel>:<class>.<method>:<name>`. User can edit `SKILL.md` and
   `prompts/discovery.md` to override.

**Total user-facing prompts in the happy path: 5.**

1. Target question (open).
2. Naming batch (4 fields, accept-all default).
3. Repo context batch (4 fields, accept-all default).
4. Decisions + target (one decision-set choice + one free-form target string).
5. Uncertainty follow-ups from `rule-author` (typically 0-2 questions).

### Inferred vs. asked

| Field | Source | When |
|---|---|---|
| Primary language, source roots, repo layout | Pre-scan | Confirm in batch 2 |
| Full dependency list | Pre-scan | Used silently to build framework filter |
| Framework subset for this entity | Pre-scan filtered by entity domain | Confirm in batch 2 |
| Deployment-context hints | Pre-scan | Shown as grounding in batch 3, not proposed |
| Existing analyzer collisions | Pre-scan (`Glob .claude/skills/analyze-*`) | Used in batch 1 to suggest non-colliding name |
| Target question | User open prompt | Step 2 |
| `analyzer_name`, `entity_name_human`, `entity_key`, `id_field` | Derived from target question + scan | Confirm in batch 1 |
| `decision_enum` | Entity-pattern lookup with "write your own" escape | Confirm in batch 3 |
| `target_const` | User free-form, scan shown as grounding | Asked in batch 3 |
| Identity convention | Silent default per language | Surfaced in summary |
| `requires_serena`, `requires_context7` | Silent default `true/true` | Surfaced in summary |
| Phase C section in `discovery.md` | Always included | Pruned later by `rule-author` or human |
| `emittable_rule_ids` | **Removed.** Derived from drafted `rules.md` post-dispatch | Never asked |
| Drafted `rules.md` | `rule-author` subagent + uncertainty round | Step 6 |

### Degraded modes

- **Empty target dir or no recognizable manifest** → batch 2 falls back to open
  questions for language, source roots, and frameworks.
- **Polyglot repo with no clear primary** → Claude lists what it found and asks
  the user to pick the language to focus on.
- **Name collision in batch 1** → Claude proposes a suffixed name
  (`analyze-logging-2`) as the default and asks for the real one.
- **Subagent returns malformed JSON envelope** → abort with the raw output.
  No partial stamp.
- **Subagent returns `rule_ids: []` or decisions outside `decision_enum`** →
  abort. Hard invariants from the agent's own playbook; not auto-fixable.
- **Subagent's `rule_ids` field disagrees with the IDs extracted from the
  `rules_md` table** → abort with a diff.

### `rule-author` dispatch contract

#### Input brief

```
MODE: dispatch
You were invoked by /new-analyzer to produce an initial rules.md draft.
Do NOT ask the user any questions. Apply your authoring playbook to the
inputs below and return the JSON envelope specified at the bottom.

INPUTS:
- target_question:    "<one sentence>"
- entity_name_human:  "<e.g., Log call-site>"
- entity_key:         "<e.g., entries>"
- id_field:           "<e.g., call_site_id>"
- decision_enum:      ["allow", "redact", "remove"]
- target_const:       "pii-regulated"
- language:           "java"
- frameworks:         ["slf4j", "logback"]
- source_roots:       ["src/main/java"]

OUTPUT (return exactly this JSON envelope, no surrounding prose):
{
  "ruleset_version": "<today YYYY-MM-DD>",
  "rules_md":        "<full markdown content of rules.md>",
  "rule_ids":        ["R0", "R1", ...],
  "uncertainties":   [{ "topic": "...", "question": "...", "why": "..." }]
}
```

`rules_md` must conform to the existing section ordering: Version, Valid rule
IDs, Rule labels table, Evaluation order, Confidence. `rule_ids` is the
canonical list extracted from the table; it feeds the `RULE_IDS` and
`RULE_IDS_WITH_NONE` substitutions in `stamp.mjs`.

#### Uncertainty channel

The subagent emits one entry per genuine ambiguity it could not resolve from
the brief alone:

```json
{
  "topic": "rule_R2",
  "question": "Should R2 fire before R3, or after? Depends on whether mutability matters for your decision.",
  "why": "Brief didn't specify whether mutated-after-put logs should redact or remove."
}
```

Empty `uncertainties[]` is a strong claim of confidence — the agent's prompt
must instruct it not to make that claim falsely.

#### Resolution loop

After dispatch returns:

1. Show the drafted `rules.md` to the user (full content, fenced).
2. List uncertainties as numbered targeted questions.
3. For each uncertainty answered, Claude in the main conversation edits the
   in-memory `rules_md` string inline. Subagent context is gone; we're done
   with it.
4. User confirms ("looks good, stamp it") or makes additional edits inline.
5. `/new-analyzer` extracts `rule_ids` from the resolved `rules_md`,
   builds the internal config object (including `rule_ids`), and invokes
   `stamp.mjs`. Once `stamp.mjs` returns success, `/new-analyzer` writes
   `rules.md` directly into the scaffolded skill dir using the `Write` tool
   (stamp does not produce it).

If the user rejects the draft wholesale, the answer is "delete the staged
work and re-run `/new-analyzer`." We don't try to recover mid-flow.

## Implementation surface

### `stamp.mjs`

**Required config keys (was → is):**

| Was | Is |
|---|---|
| `analyzer_name` | unchanged |
| `entity_name_human` | unchanged |
| `entity_key` | unchanged |
| `id_field` | unchanged |
| `target_const` | unchanged |
| `decision_enum` | unchanged |
| `emittable_rule_ids` | **removed** |
| — | `language` (new, required) |
| — | `frameworks` (new, required, may be empty array) |
| — | `source_roots` (new, required, non-empty array) |
| — | `manifest_list` (new, required, non-empty array — supplied by `/new-analyzer` from its per-language table) |
| — | `rule_ids` (new, required, derived from drafted `rules.md`) |
| — | `target_question` (new, required, used in `SKILL.md` description) |
| — | `identity_convention` (new, optional, default per language) |
| — | `phase_c_hint` (new, optional, default = "no config-driven candidates detected — delete this section if appropriate") |

`requires_serena` and `requires_context7` keep current optional defaults (true).

**Validation additions:**

- `language`: matches `[a-z][a-z0-9+-]*`.
- `frameworks`: array of non-empty strings (may be empty).
- `source_roots`: non-empty array of non-empty path-shaped strings.
- `manifest_list`: non-empty array of non-empty filename strings.
- `rule_ids`: non-empty array of non-empty strings. The current
  `analysis.schema.json.tmpl` (line 54) puts no regex on individual labels —
  it just substitutes them into a `rule_fired` enum verbatim. Whatever the
  ruleset uses (`R0`/`R8a`/`L1`/etc.) is fine; only non-emptiness is
  enforced.

**New substitution tokens:**

| Token | Source | Used in |
|---|---|---|
| `{{LANGUAGE}}` | `config.language` | `discovery.md` (manifest list grounding) |
| `{{FRAMEWORK_LIST}}` | `config.frameworks` quoted/joined | `discovery.md` Phase A |
| `{{FRAMEWORK_REGEX}}` | derived from `config.frameworks` | `discovery.md` Phase A step 3 |
| `{{MANIFEST_LIST}}` | `config.manifest_list` (passed in by `/new-analyzer` from its per-language table) | `discovery.md` Phase A step 1 |
| `{{SOURCE_ROOTS}}` | `config.source_roots` joined | `discovery.md` Phase A step 1 |
| `{{IDENTITY_CONVENTION}}` | `config.identity_convention` | `discovery.md` Phase B |
| `{{PHASE_C_HINT}}` | `config.phase_c_hint` | `discovery.md` Phase C |
| `{{TARGET_QUESTION}}` | `config.target_question` | `SKILL.md` description |

**Removed responsibility:** stamp.mjs no longer produces `rules.md`.
`/new-analyzer` writes it directly with the drafted content after `stamp.mjs`
finishes.

### Templates

**`_core/templates/rules.md.tmpl` — delete.** The structural spec (sections,
ordering, confidence table) moves into `agents/rule-author.md` § Dispatch mode
as the output contract.

**`_core/templates/prompts/discovery.md.tmpl` — substituted, not authored:**

- Phase A intro: replace `*Author task: list the libraries whose presence this
  analyzer should detect*` with concrete `{{FRAMEWORK_LIST}}`.
- Phase A step 1 (manifest enumeration): substitute `{{MANIFEST_LIST}}`. The
  per-language list (e.g., `pom.xml`/`build.gradle*` for Java, `package.json`
  for JS/TS, `pyproject.toml`/`requirements.txt`/`Pipfile` for Python, etc.)
  is computed by `/new-analyzer` from its own lookup table and passed into
  `stamp.mjs` as a config value.
- Phase A step 1 (path scope): substitute `{{SOURCE_ROOTS}}`.
- Phase A step 3: replace `*fill in the regex for your domain*` with
  `{{FRAMEWORK_REGEX}}`.
- Phase B identity convention paragraph: replace open-ended *"Pick a convention
  for your domain"* with the actual `{{IDENTITY_CONVENTION}}`.
- Phase C: replace the *"Delete this section if your domain has no ad-hoc..."*
  header with `{{PHASE_C_HINT}}`.

**`_core/templates/SKILL.md.tmpl`:**

- Description line: prepend the substituted `{{TARGET_QUESTION}}` so the skill
  description carries the analyzer's purpose.

**`_core/templates/prompts/classification.md.tmpl`:** no changes — already
generic and reads from `rules.md`.

**`_core/templates/schema/*.json.tmpl`:** no changes. The `rule_fired` enum
still uses `RULE_IDS` and `RULE_IDS_WITH_NONE` substitutions; only the source
of those values changes (now from `config.rule_ids`).

**`_core/templates/package.json.tmpl`:** no changes.

### `commands/new-analyzer.md`

- Frontmatter: `argument-hint: [target-root]`. `allowed-tools` adds `Glob`,
  `Grep`, and the subagent-dispatch tool. In Claude Code the subagent
  dispatcher is `Task` — add it to `allowed-tools`. No existing command in
  this plugin dispatches a subagent yet, so this is a new addition; verify
  against the runtime's docs at implementation time if the name has shifted.
- Body owns the **per-language lookup table** for manifest filenames, default
  source roots, and default identity-convention templates. `/new-analyzer`
  reads this table during the preflight scan (to detect the language) and
  during stamp-input building (to compute `{{MANIFEST_LIST}}`,
  `{{SOURCE_ROOTS}}` defaults, `{{IDENTITY_CONVENTION}}` default). Initial
  language coverage: Java, Kotlin, JS/TS, Python, Go, Rust, .NET, Ruby, PHP,
  Elixir.
- Body: delete the entire "Domain config shape" section. Replace "Steps" with
  the 7-step flow above. Add a new "Interview prompts" section listing the 5
  user-facing prompts so the command is self-documenting.
- Hard rules: add *"Never proceed to stamp.mjs without a complete, validated
  config object built from the interview. If the user aborts mid-interview,
  exit cleanly with no scaffolded output."*

### `agents/rule-author.md`

- Add **§ Dispatch mode** documenting the input brief shape, the JSON envelope
  output, and the requirement to populate `uncertainties[]` honestly.
- Add **§ Output structure for `rules_md`** specifying the section ordering
  inherited from the deleted `rules.md.tmpl` (Version, Valid rule IDs, Rule
  labels table, Evaluation order, Confidence).
- Wrap existing **§ Your process** under a **"Interactive mode (default)"**
  header — interactive remains the default when no `MODE: dispatch` marker is
  present.
- Existing **§ Hard rules** unchanged — they apply in both modes.

### Tests

- `_core/bin/stamp.test.mjs`: update fixture configs to remove
  `emittable_rule_ids`, add the new required keys, update assertions for new
  substitutions.
- `_core/bin/scaffold-e2e.test.mjs`: same fixture updates; verify `discovery.md`
  and `SKILL.md` substitutions land correctly; verify `rules.md` is *not*
  produced by stamp.
- New tests: `stamp.mjs` aborts when `rule_ids` is empty or when any new
  required key is missing.

### Docs and examples

- `CHANGELOG.md` — v0.2.0 entry: breaking config shape change, new interactive
  `/new-analyzer`, removed `rules.md` from stamp output.
- `README.md` (root) and `plugins/agentic-analyzer/README.md` — replace the
  "Domain config shape" example with the new "just run `/new-analyzer`"
  workflow description.
- `docs/INSTALL.md` — verify it doesn't reference the old config-handing flow.
- `examples/analyze-logging/` and `examples/logging-config.json` — regenerate
  by running the new `/new-analyzer` against a sample target, or rebuild
  manually to match the new shape.

## Risks

- **`rule-author` draft quality is the new ceiling.** A weak first-pass ruleset
  becomes the starting point for every analyzer. Mitigation: the uncertainty
  channel forces the agent to surface ambiguity rather than guess; the user
  always sees the draft and can edit inline before stamp.
- **Per-language manifest/source-root lookup tables grow.** Initial scope:
  Java, Kotlin, JS/TS, Python, Go, Rust, .NET, Ruby, PHP, Elixir. Languages
  outside this set fall through to "ask blank" — degraded but not broken.
- **Entity-pattern lookup for `decision_enum` won't cover every domain.** The
  "write your own" escape hatch keeps the path open; over time the lookup
  table grows from real usage.
- **JSON envelope parsing from a subagent is fragile.** Mitigation: hard-fail
  on malformed output and tell the user to re-run, rather than trying to
  partially recover.

## Open questions for implementation

None remaining — all design questions resolved. Implementation will surface
its own questions at code time (test fixture choices, error message phrasing,
exact regex for `{{FRAMEWORK_REGEX}}` derivation), but those don't affect the
design.
