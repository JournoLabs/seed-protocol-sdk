# Architecture Decision Records

Short records of decisions that shape this repo: what we decided, why, and what it
costs us. They explain *why the code looks the way it does* to someone arriving later.
Design studies, plans, implementation logs and handoffs are working documents: keep them in
`docs/private/` (gitignored) while the work is open, and record the decisions they lead to here.
Public docs in `docs/` describe how things work for users and contributors.

## Index

| # | Decision | Status |
|---|---|---|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-component-styling-tokens-and-injected-css.md) | Style exported components with `--seed-*` tokens and an injected stylesheet | Accepted |
| [0003](0003-icons-vendored-from-lucide.md) | Vendor Lucide icons instead of depending on an icon package | Accepted |
| [0004](0004-opfs-files-manager-behavior.md) | OPFSFilesManager: thumbnails, grouping, downloads, and deletes | Accepted |
| [0005](0005-shared-design-system.md) | A shared design system for exported UI | Proposed |
| [0006](0006-schema-scoped-seeds.md) | Schemas scope seeds on the client, not on-chain | Accepted (not implemented yet) |
| [0007](0007-ci-publishing-and-branch-prereleases.md) | Publish from CI with trusted publishing, and prerelease every branch | Accepted |
| [0008](0008-schema-names-on-eas.md) | One EAS name per property and model, matched loosely when reading | Accepted |
| [0009](0009-name-match-strictness.md) | A schema sets how strictly EAS names match its models and properties | Accepted |
| [0010](0010-number-encoding-on-eas.md) | Number properties are published as decimal strings | Accepted |
| [0011](0011-reading-a-seed-at-a-version.md) | Reading a seed at a version takes a time as well as a version uid | Accepted |
| [0012](0012-tabs-coordinate-through-web-locks.md) | Browser tabs coordinate through Web Locks and one leader tab | Accepted |
| [0013](0013-nextjs-browser-only-through-next-package.md) | Next.js support is browser-only, through `@seedprotocol/next` | Accepted |
| [0014](0014-entities-proxy-actor-context-id-caches.md) | Entity state lives in actor context behind reactive proxies; caches are keyed by stable id | Accepted |
| [0015](0015-database-reactivity-through-livequery.md) | Database reactivity goes through `BaseDb.liveQuery` | Accepted |
| [0016](0016-schema-changes-write-version-files.md) | Schema changes write a new version file; database rows change in place by id | Accepted |
| [0017](0017-mapping-headless-core-props-ui.md) | `@seedprotocol/mapping`: a headless core, a props-driven UI, and edges as the saved format | Accepted |
| [0018](0018-fixed-sdk-tables-no-runtime-codegen.md) | Fixed SDK tables and app schemas as rows; no runtime code generation | Accepted |
| [0019](0019-item-writes-through-an-outbox.md) | Item edits go through a durable outbox that the leader tab drains | Accepted (being implemented) |
| [0020](0020-entity-reactivity-through-a-change-log.md) | Loaded entities learn about row changes from one trigger-fed change log | Accepted (being implemented) |
| [0021](0021-clearing-a-property.md) | A property is cleared by attesting an empty value or by revoking its attestations | Accepted (being implemented) |
| [0022](0022-properties-may-reference-the-seed.md) | Readers can accept property attestations that reference the Seed | Proposed |
| [0023](0023-sealed-versions.md) | An owner can seal a Version; revoking a sealed value still removes it | Proposed |
| [0024](0024-raw-tcp-tunnel-mode.md) | gateway-hyper carries raw TCP as a second protocol, on its own key | Accepted |
| [0025](0025-gateway-neutral-html-links.md) | Published Html names one gateway; every Seed reader re-hosts its links | Accepted |

## Writing one

1. Copy [`template.md`](template.md) to `NNNN-short-title.md` with the next number.
2. Keep it to one decision. Link related ADRs instead of repeating them.
3. Start as **Proposed**. Change to **Accepted** when the decision is made, usually in
   the same change that implements it.
4. Don't rewrite accepted ADRs. To change a decision, write a new ADR and mark the old
   one **Superseded by NNNN**.
5. Add a row to the index above.
