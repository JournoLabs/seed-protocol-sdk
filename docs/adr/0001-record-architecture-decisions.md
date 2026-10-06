# 0001. Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-10-06
- **Scope:** Whole repo

## Context

`docs/` holds design studies, specs, and handoffs, but nothing records the decisions
themselves in one place. When a choice is revisited (for example how a component is
styled, or why a dependency was avoided) the reasoning has to be rebuilt from commit
messages and old conversations.

## Decision

Keep Architecture Decision Records in `docs/adr/`, numbered sequentially, one decision
per file, using `docs/adr/template.md`. The process is in `docs/adr/README.md`.

Write an ADR when a decision:

- constrains how future code in more than one file or package should be written,
- changes a public API's behavior or defaults, or
- picks between options that someone is likely to question later.

## Consequences

- Reviewers can point to an ADR instead of re-arguing a settled choice.
- ADRs are append-only once accepted, so the record stays honest about what we knew
  at the time.
- Small cost per decision. Not every change needs one.
