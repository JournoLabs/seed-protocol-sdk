# 0013. Next.js support is browser-only, through `@seedprotocol/next`

- **Status:** Accepted
- **Date:** 2026-10-18 (records decisions made and implemented 2026-10-17)
- **Scope:** `@seedprotocol/next`, `@seedprotocol/bundler-core` (private), `@seedprotocol/sdk` (platform entries, `withSeed` in `@seedprotocol/sdk/node`), `@seedprotocol/react`

## Context

`@seedprotocol/vite` was the only bundler integration. Next 16 builds with Turbopack by default,
which ignores webpack plugins and reads `turbopack.resolveAlias` and the rest of `next.config`.
Next 15 builds with webpack by default. A spike installed the SDK from packed tarballs into an App
Router app and ran a create, reload, read-back round trip in Chromium under both bundlers on Next
16.4 and 15.5. With a few SDK fixes, two things were enough: `fs` aliased to ZenFS in browser
builds only, and cross-origin isolation headers. Most of the Vite plugin's shims were not needed.

## Decision

- **Browser only.** The SDK runs in the browser in Next apps. There is no server-side support
  (route handlers or server components reading seeds) until a user brings a concrete use case.
  Server builds only have to not break.
- **Versions.** Next 16 is supported under Turbopack and webpack, Next 15 under webpack only. Next
  15 with Turbopack is unsupported: its blob-URL workers can't resolve SQLite's WASM URL, so
  storage falls back to memory and init fails. `withSeed` warns when it detects it.
- **`withSeed(nextConfig, options)`** in `@seedprotocol/next` takes a config object or function
  and returns the same kind. It adds the browser-only `fs` aliases for both bundlers, points
  `#seed-node-platform` and `@seedprotocol/query` at their browser builds in every graph, and adds
  COOP `same-origin`, COEP `credentialless` and CORP `same-origin` headers. The user's own aliases,
  `webpack` function and headers are kept and win where they overlap.
- **Shared code** lives in the private `@seedprotocol/bundler-core`, which the Vite and Next builds
  inline, so it is never a runtime dependency.
- **No separate webpack package.** Outside Next, a webpack client config needs only the two `fs`
  aliases. `withSeed` in `@seedprotocol/sdk/node` is deprecated.

Three SDK changes came with this and stay:
- `@seedprotocol/react` ships with `'use client'`.
- The Node platform is imported through a `package.json` `imports` entry (`#seed-node-platform`)
  that maps to the browser platform under the `browser` condition, so browser bundles no longer
  carry the Node platform or libsql.
- `@seedprotocol/vite` is an optional peer of the SDK.

## Consequences

Next apps get a one-line config. The `@seedprotocol/vite` change is breaking for apps that import
`@seedprotocol/sdk/vite` without installing `@seedprotocol/vite`. Rspack and plain webpack 5
outside Next are untested, and what Safari needs with `COEP: credentialless` is unverified.

## Alternatives considered

- **Server-side support now.** No user has asked for it, and it would need a Node storage story
  inside Next's server runtime.
- **Porting the Vite plugin's shims.** The spike showed both bundlers handle the SDK's CommonJS
  dependencies without them.
- **A plain-webpack package.** Two aliases don't justify a package.
