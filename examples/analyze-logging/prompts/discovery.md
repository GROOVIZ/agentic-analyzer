# Discovery prompt (Phase A/B/C)

You are conducting the discovery phase of logging analysis on a
target repository.

Produce a single JSON object conforming to `schema/candidates.schema.json`:

```json
{
  "frameworks": [ ... ],
  "candidates": [ ... ]
}
```

Emit only the JSON object. No prose, no commentary, no markdown code fences
in the final output.

## Phase A — Framework survey (uses Context7)

The declared frameworks for this analyzer are `["slf4j", "logback"]`. Phase A
walks the target repo's build manifests, confirms which of these are in scope
for the current repo, and pulls their Log call-site surfaces from
Context7.

1. List every build manifest in the target repo matching
   `["pom.xml", "build.gradle", "build.gradle.kts"]`, restricted to source roots `["src/main/java"]`.
2. Extract all declared dependencies from those manifests.
3. Apply the fast-path coordinate regex `/(slf4j|logback)/i` to pre-filter.
4. For each match, fetch the library's docs via Context7 and extract
   Log call-site surfaces:
   - `{ "kind": "annotation",  "fqn": "<fully-qualified-name>" }`
   - `{ "kind": "builder",     "fqn": "<fully-qualified-name>" }`
   - `{ "kind": "config_key",  "key": "<dotted.config.key>" }`
   - `{ "kind": "api_call",    "fqn": "<method-fqn>" }`
5. If Context7 returns no record for a library, add a `degradations[]` entry
   to the coverage report (stage `"context7"`, library, reason).
6. Record each surveyed library in the `frameworks[]` array.

## Phase B — Symbolic enumeration (uses Serena)

For every `surfaces[*]` record produced in Phase A:

- **Annotations / API calls** → call
  `mcp__plugin_serena_serena__find_symbol` by FQN, then
  `mcp__plugin_serena_serena__find_referencing_symbols` to collect every
  annotated or calling site.
- **Builder classes** → call `find_symbol` + `find_referencing_symbols` for
  every call site.
- **Config keys** → defer to Phase C.

For each hit:

- Issue a targeted `Read` for a 30-line window around the symbol range
  returned by Serena. Never read a full file unless it is under 200 lines.
- Construct a candidate:

```json
{
  "call_site_id": "<stable identity — see below>",
  "name": "<short human name>",
  "description": "<one-line summary>",
  "source": {
    "file": "<relative-path>",
    "line_start": 42,
    "line_end": 72,
    "snippet": "<30-line window>",
    "snippet_sha256": "<sha256 of raw snippet>",
    "snippet_normalized_sha256": "<sha256 of normalized snippet>"
  }
}
```

Compute the hashes by piping the snippet through the normalizer:

```
printf '%s' "$SNIPPET" | node $SKILL_DIR/bin/normalize.mjs
```

Output is `<raw>\t<normalized>`.

### Identity convention for `call_site_id`

The ID must be stable across runs for the same source construct. For this
analyzer: `<lang>:<rel>:<class>.<method>:<name>`. The override engine relies on this
convention; changing it invalidates all existing overrides.

## Phase C — Ad-hoc + config correlation

No config-driven candidates detected at scaffold time. Delete this section if your domain has no ad-hoc or config-driven candidates; otherwise fill in what to correlate.

If this analyzer has config-driven or ad-hoc candidates, describe:

- What "ad-hoc" means in your domain (e.g., bare `HashMap` fields, plain
  `System.out.println`, environment-variable reads).
- The shape gate that separates real candidates from false positives.
- How config files (e.g., `application.yml`, `logback.xml`, `.env`) are
  parsed and correlated with symbolic candidates.
- Redaction rules for secret-like values.

Merge by identity: if a Phase C candidate has the same `call_site_id` as a
Phase B candidate, keep Phase B and discard the Phase C duplicate (but
preserve the Phase C `config_refs[]` on the surviving entry if you model
that).
