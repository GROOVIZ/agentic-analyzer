# agentic-analyzer

[![tests](https://img.shields.io/badge/tests-green-brightgreen)](./plugins/agentic-analyzer/_core/bin)
[![version](https://img.shields.io/badge/version-0.3.0-blue)](./CHANGELOG.md)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

A Claude Code **plugin marketplace** hosting plugins that implement or
support the **agentic-analyzer pattern** — LLM-judged,
schema-validated, replayable code analyzers.

An *analyzer*, in this marketplace, is a Claude Code skill that walks
a target repository with LLM judgment (non-deterministic) and emits a
structured inventory (deterministic) of a specific kind of thing —
caches, log call-sites, feature flags, session state, auth boundaries,
... — classified against a versioned ruleset, with reviewer overrides
that replay across runs.

The pattern's **twelve invariants** are documented at
[`docs/pattern.md`](./docs/pattern.md). A one-page author reference
lives at [`docs/PATTERN-CARD.md`](./docs/PATTERN-CARD.md).

## Plugins in this marketplace

| Plugin | Role | Status |
|---|---|---|
| [`agentic-analyzer`](./plugins/agentic-analyzer) | **Authoring kit.** Scaffolds new analyzer skills via an interactive `/new-analyzer` interview (with fixture auto-gen + post-stamp quality gate) and a companion `/expected-entities` command for feeding dev-team oracle lists into the discovery backstop. Ships five specialist subagents and the generic `_core/` runtime. | 0.3.0 |

Pre-built analyzers (caches, logging, feature flags, session state,
...) are planned. Each new plugin lands as a `plugins/<name>/`
directory with its own `.claude-plugin/plugin.json`; the marketplace
manifest is updated to list it.

## Install

### As a marketplace (recommended)

```
claude plugin marketplace add <this-repo-url>
claude plugin install agentic-analyzer@agentic-analyzer
```

Then, to pull new versions or newly-added plugins later:

```
claude plugin marketplace update agentic-analyzer
```

### As a single plugin

If you only want the authoring kit and don't care about marketplace
semantics:

```
claude plugin install <this-repo-url>/plugins/agentic-analyzer
```

### Local / vendored

Clone the repo, register the plugin path in your Claude Code
`settings.json` — full options in [`docs/INSTALL.md`](./docs/INSTALL.md).

Prerequisite: the plugin's `_core/` runtime needs Ajv:

```
npm --prefix plugins/agentic-analyzer/_core install
npm --prefix plugins/agentic-analyzer/_core test    # node --test, all green
```

## Start here

1. Read [`docs/pattern.md`](./docs/pattern.md) — what you're buying
   into (twelve invariants, forty-five minutes).
2. Skim [`docs/PATTERN-CARD.md`](./docs/PATTERN-CARD.md) — the
   cheat-sheet to keep open while authoring.
3. Read the authoring-kit plugin's README:
   [`plugins/agentic-analyzer/README.md`](./plugins/agentic-analyzer/README.md).
   The interactive `/new-analyzer` workflow and next steps are there.

## Worked example

- [`examples/analyze-logging/`](./examples/analyze-logging) — a
  freshly-scaffolded analyzer for a PII-regulated logging domain.
  Shows what `/agentic-analyzer:new-analyzer` produces before the
  author fills in rules and prompts.

## Layout

```
.
├── .claude-plugin/
│   └── marketplace.json                 catalogue of plugins
├── plugins/
│   └── agentic-analyzer/                the authoring-kit plugin
│       ├── .claude-plugin/plugin.json
│       ├── _core/                       shared runtime (bin/, templates/)
│       ├── agents/                      four specialist subagents
│       └── commands/                    /agentic-analyzer:new-analyzer
├── docs/                                pattern spec, card, install guide, iteration log
├── examples/                            scaffolder output for the logging domain
├── CHANGELOG.md  LICENSE  README.md
```

## Status

**Pre-1.0.** Schemas and CLI contracts may change before 1.0. Semver
after 1.0.

One load-bearing design choice to surface up front: an analyzer's
`overrides.json` is a plain repo-local file. Concurrent edits across
reviewers are the user's problem — the pattern does not attempt
distributed locking. Teams that need that should stand up a small
review app around the file rather than editing it by hand. See
[`docs/pattern.md`](./docs/pattern.md) for the full rationale.

## Contributing

Fork, branch, commit, PR. Run the plugin's test suite before
submitting:

```
npm --prefix plugins/agentic-analyzer/_core test
```

## License

MIT — see [LICENSE](./LICENSE).
