# Installing the agentic-analyzer plugin

The plugin ships as a self-contained git repo. Pick one of two install
paths.

## Path 1 — Marketplace install (recommended)

This repo is a Claude Code **plugin marketplace** (see
`.claude-plugin/marketplace.json`). Subscribe once, then install any
plugin it offers:

```
# Subscribe to the marketplace
claude plugin marketplace add https://github.com/example/agentic-analyzer

# Install the authoring-kit plugin
claude plugin install agentic-analyzer@agentic-analyzer

# Later: pull new versions or newly-added plugins
claude plugin marketplace update agentic-analyzer
```

## Path 2 — Plain plugin install (single plugin, no subscription)

```
claude plugin install https://github.com/example/agentic-analyzer/plugins/agentic-analyzer
```

Works if you only want the authoring kit and don't care about getting
marketplace updates automatically.

## Path 3 — Local vendored copy

Clone the repo wherever you prefer, then register the plugin path in
your Claude Code settings:

```
git clone https://github.com/example/agentic-analyzer.git /path/to/agentic-analyzer
npm --prefix /path/to/agentic-analyzer/plugins/agentic-analyzer/_core install
npm --prefix /path/to/agentic-analyzer/plugins/agentic-analyzer/_core test   # 71 tests
```

In `settings.json` (user-global) or `settings.local.json` (per-project,
gitignored):

```json
{
  "plugins": [
    { "path": "/path/to/agentic-analyzer/plugins/agentic-analyzer" }
  ]
}
```

Restart Claude Code. The `/agentic-analyzer:new-analyzer` command, the
four specialist agents, and the shared runtime become available.

## Verifying

In a fresh session:

```
/agentic-analyzer:new-analyzer
```

If the plugin is installed correctly, you get the command's help
preamble. If you get "unknown command", the plugin path is not
registered.

To verify the four agents loaded:

```
/agents list
```

(Exact command may vary by Claude Code version; check `/help`.)

## Running the scaffolder

```
/agentic-analyzer:new-analyzer /path/to/your-domain-config.json
```

Template configs live at:

- `examples/logging-config.json` (PII-regulated log call-site analyzer)
- `examples/caches-config.json` (the reference domain)

Copy one, edit the seven required fields (plus the two optional
`requires_*` booleans), and invoke.

## Uninstalling

```
claude plugin uninstall agentic-analyzer
```

Or, for a local vendored install, delete the `plugins` entry from your
settings file. The scaffolded analyzer skills
(`.claude/skills/analyze-<name>/`) remain and keep working — they do
not depend on the plugin being installed, because `/new-analyzer`
copies all runtime utilities into the scaffolded dir.

## Troubleshooting

- **`validate.mjs` errors with "Cannot find module 'ajv/dist/2020.js'"**:
  run `npm install` inside the scaffolded skill's directory.
- **`CLAUDE_PLUGIN_ROOT` is empty**: Claude Code has not recognised
  the plugin. Check `settings.json` syntax and restart.
- **`/agentic-analyzer:new-analyzer` refuses "output path exists"**:
  the scaffolder never clobbers. Either choose a different
  `analyzer_name` in the config or delete the existing
  `.claude/skills/analyze-<name>/` dir.
- **Bash hooks fail on Windows** with path or CRLF errors: this plugin
  ships no bash hooks (all runtime is Node), so it should not be
  affected. If you extend it with hooks, use `bash "${CLAUDE_PLUGIN_ROOT}/script.sh"`
  wrapper invocation and commit `*.sh text eol=lf` in `.gitattributes`.
