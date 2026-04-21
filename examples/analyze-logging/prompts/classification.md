# Classification prompt (Phase D)

You are conducting the classification phase of logging analysis.
Input: `candidates.json` from Phase A/B/C. Output: `analysis.json`.

Apply the rules defined in `rules.md` in the **evaluation order** listed
there (NOT numerical label order). The first rule that fires decides the
case.

## Per-entry output

For every candidate that survives triage, emit an entry in `entries[]`:

```json
{
  "call_site_id": "<from candidate>",
  "name": "<from candidate>",
  "description": "<optional>",
  "source": { /* copied verbatim from candidate */ },
  "decision": "<one of: "allow", "redact", "remove" or null>",
  "decision_source": "rule",
  "rule_fired": "R<N>",
  "rationale": "<one sentence — quote the evidence>",
  "confidence": "high | medium | low",
  "analysis_status": "complete | partial | needs_review"
}
```

- `decision_source` must be `"rule"` in Phase D. The override-replay step
  rewrites it to `"override"` for matched overrides.
- `decision` is `null` iff `rule_fired` is the catch-all (e.g., `R10`) and
  your ruleset treats that as "needs_review".
- `rationale` cites the specific clause of the rule that fired — no
  hand-waving. Quote the evidence (line snippet, config value, call-site).
- `confidence` follows the table in `rules.md`. Drop to `low` whenever
  Serena left a symbol unresolved or Context7 was unavailable.

## Triage and short-circuits

If your ruleset includes a drop rule (e.g., R0 "not-a-thing"), run it first
and elide matching candidates from `analysis.json` entirely. Record drops
in an audit file so reviewers can inspect them, and increment a
`<drop>_dropped` counter in `coverage.json`.

## Catch-all

If no rule fires, record `rule_fired: "R<last>"`, `decision: null`,
`analysis_status: "needs_review"`, and `confidence: "low"`. Reviewers will
decide via the override engine.
