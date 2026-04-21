# Log call-site Classification Rules

**Version:** `ruleset_version: "YYYY-MM-DD"` — update this when you change any rule.
**Target (fixed):** pii-regulated.

Apply rules in the **evaluation order** below. The first rule that fires
decides the case. Rule labels are stable across versions; they are NOT
evaluated in numerical order.

## Valid rule IDs for this analyzer

The `analysis.schema.json` stamped from the domain config accepts exactly
these rule IDs in the `rule_fired` field (plus `"none"`):

`["L1", "L2", "L3", "L4", "L5"]`

**Author task:** edit the table below so every ID above has exactly one row,
and nothing else does. If you add a rule, update the table and re-run
`/new-analyzer`'s rule-author dispatch (or edit `rule_ids` directly and
re-stamp).

## Rule labels

| ID | Rule | Decision |
|---|---|---|
| L1 | *(optional drop rule — candidate is not a Log call-site)* | **dropped** |
| L2 | ... fill in ... | `<one of: "allow", "redact", "remove">` |
| L3 | ... fill in ... | `<one of: "allow", "redact", "remove">` |
| L4 | ... fill in ... | `<one of: "allow", "redact", "remove">` |
| L5 | Nothing above fires. | `needs_review` (decision: `null`) |

Decisions in this analyzer are drawn from: `["allow", "redact", "remove"]`.
The catch-all rule emits `decision: null` and `analysis_status: "needs_review"`.

## Evaluation order

Document the order here. It is not numerical. A typical shape:

1. Drop rule (if any) — triage before any classification.
2. Dead-code or cheap detectable errors — short-circuit early.
3. Identity-driven rules — data shape dictates decision regardless of shape.
4. Target-topology rules — e.g., handler scope forces a specific decision.
5. Happy-path rules — the base case, typically split on one axis (PII
   category, message-template kind, log level).
6. Catch-all (`L5`) — everything else → `needs_review`.

## Confidence

- **High** — a single rule fired cleanly, or evaluation order cleanly broke a
  tie between clear matches; Serena resolved every referenced symbol;
  Context7 was available for the framework in scope.
- **Medium** — classification reached a decision despite partial symbol
  resolution, *or* the match required subjective interpretation.
- **Low** — any referenced symbol went unresolved, *or* Context7 was
  unavailable for the framework in scope, *or* the catch-all rule fired.
