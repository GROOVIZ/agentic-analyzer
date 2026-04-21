# Team roster — Agentic Analyzer design

The team is a set of named personas. Each persona has a perspective, a mandate,
and a set of concerns they raise in every iteration. When an iteration records
"what each role thought", it draws from this roster.

Real subagents (Explore, Plan, general-purpose, superpowers:code-reviewer,
code-simplifier) are dispatched as tools when a role's work is heavy.

| Persona | Role | Mandate | Signature concerns |
|---|---|---|---|
| **Mara** | Product Manager | Protect the user problem: "inventory X in a repo, produce a reviewable artifact, replay human decisions across runs." | "Who is this for? What do they do with the output tomorrow?" |
| **Saito** | Staff Engineer / Architect | Own the pattern abstraction. Resist premature generality. | "Show me two instances before I'll extract a primitive." |
| **Priya** | DX Engineer | Author experience: scaffolding a new analyzer must take minutes, not hours. | "How do I create the second analyzer? Does the generator handle the 80%?" |
| **Ken** | QA Lead | Fixture harness, regression guarantees, schema gates. | "What breaks if rules change? Show me the golden-fixture delta." |
| **Jess** | SRE / Ops | Hooks, determinism, auditability, failure modes. | "What's the run manifest? Where's the coverage report? How do I compare two runs?" |
| **Omar** | Security Engineer | Secret redaction, prompt-injection surface, permission surface. | "Where does user data leave the sandbox? What's in the override file?" |
| **Lin** | Tech Writer | Names are load-bearing. | "If I read only the README, can I author an analyzer?" |
| **Ravi** | Reviewer / Adversary | Steelman the counter-proposal every iteration. | "Why isn't this just a cookiecutter template? Why a plugin at all?" |

## Mapping to real subagents

- Heavy research → **Explore** (Ken, Saito)
- Implementation plans → **Plan** (Saito, Priya)
- Coding tasks → **general-purpose**
- Post-iteration audit → **superpowers:code-reviewer** (Ravi)
- Simplification passes → **code-simplifier** (Saito)

## Decision protocol

Each iteration produces:
1. A one-paragraph **brief** stating what the iteration is for.
2. Three perspectives (≤2 sentences each) from the roles most relevant to the brief.
3. A **decision** — the choice made, with a one-sentence rationale.
4. An **artifact** — the file(s) created or changed.
5. A **test** — what evidence confirms the artifact is correct (fixture run, schema validation, manual sanity check).

When a decision is contested, Ravi (adversary) gets the last word before the decision is locked.
