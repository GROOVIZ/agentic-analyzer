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

```
TARGET_ROOT=$(realpath "${1:-.}")
PLUGIN_ROOT="$CLAUDE_PLUGIN_ROOT"
```

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

```
I propose:
  analyzer_name:     logging
  entity_name_human: Log call-site
  entity_key:        entries
  id_field:          call_site_id

Confirm, or reply with corrections (e.g., `entity_key: events`).
```

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

```
From scanning <target>:
  language:      java
  source_roots:  src/main/java
  frameworks:    slf4j, logback
  manifests:     pom.xml, build.gradle, build.gradle.kts
  layout:        single project

Confirm, or reply with corrections.
```

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

```
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
```

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

```
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
```

Optional: include `identity_convention` if a non-default was chosen.
Omit otherwise (stamp applies the default).

Write the config to a temp file (e.g., a `config.json` in a tmp dir
created by `mktemp -d` or Node equivalent). Run:

```
SKILL_DIR="$TARGET_ROOT/.claude/skills/analyze-$ANALYZER_NAME"
node "$PLUGIN_ROOT/_core/bin/stamp.mjs" \
  --config="$TMP_CONFIG" \
  --templates="$PLUGIN_ROOT/_core/templates" \
  --out="$SKILL_DIR"
```

On non-zero exit: delete the tmp config, surface stderr, abort. The
stamper cleans up its own staging dir on failure.

After stamp succeeds, write `rules.md` directly using the `Write` tool:

```
Write to $SKILL_DIR/rules.md with the resolved rules_md content.
```

Copy runtime utilities verbatim (unchanged from the old command):

```
mkdir -p "$SKILL_DIR/bin"
cp "$PLUGIN_ROOT/_core/bin/_args.mjs"                   "$SKILL_DIR/bin/"
cp "$PLUGIN_ROOT/_core/bin/validate.mjs"                "$SKILL_DIR/bin/"
cp "$PLUGIN_ROOT/_core/bin/normalize.mjs"               "$SKILL_DIR/bin/"
cp "$PLUGIN_ROOT/_core/bin/compare-fixture.mjs"         "$SKILL_DIR/bin/"
cp "$PLUGIN_ROOT/_core/bin/replay-overrides.mjs"        "$SKILL_DIR/bin/"
cp "$PLUGIN_ROOT/_core/bin/migrate-overrides-v1-v2.mjs" "$SKILL_DIR/bin/"
cp "$PLUGIN_ROOT/_core/bin/fixture-init.mjs"            "$SKILL_DIR/bin/"
```

Delete the tmp config.

Print to the session:

```
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
```

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
