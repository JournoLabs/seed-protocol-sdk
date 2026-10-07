# Architecture Decision Records

Short records of decisions that shape this repo: what we decided, why, and what it
costs us. They explain *why the code looks the way it does* to someone arriving later.
Design studies and specs stay in `docs/` (for example `FIELD_MAPPER_REDESIGN.md`); an
ADR records the decision a study led to.

## Index

| # | Decision | Status |
|---|---|---|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-component-styling-tokens-and-injected-css.md) | Style exported components with `--seed-*` tokens and an injected stylesheet | Accepted |
| [0003](0003-icons-vendored-from-lucide.md) | Vendor Lucide icons instead of depending on an icon package | Accepted |
| [0004](0004-opfs-files-manager-behavior.md) | OPFSFilesManager: thumbnails, grouping, downloads, and deletes | Accepted |
| [0005](0005-shared-design-system.md) | A shared design system for exported UI | Proposed |
| [0006](0006-schema-scoped-seeds.md) | Schemas scope seeds on the client, not on-chain | Accepted |

## Writing one

1. Copy [`template.md`](template.md) to `NNNN-short-title.md` with the next number.
2. Keep it to one decision. Link related ADRs instead of repeating them.
3. Start as **Proposed**. Change to **Accepted** when the decision is made, usually in
   the same change that implements it.
4. Don't rewrite accepted ADRs. To change a decision, write a new ADR and mark the old
   one **Superseded by NNNN**.
5. Add a row to the index above.
