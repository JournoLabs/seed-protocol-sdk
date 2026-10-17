# Next.js and webpack support: plan

Status: spike, SDK fixes, shared core and `@seedprotocol/next` done 2026-10-17 on
`feat/next-integration`; not merged or released. Docs and release wiring (step 6) are partly done.
Spike apps and how to rerun them are in [spikes/README.md](../spikes/README.md).

## Decisions

- **Browser only.** We recommend using the SDK only in the browser in Next apps. No server-side
  support (route handlers, server components reading seeds) until a real user brings a use case
  with details. The integration only has to keep server builds from breaking.
- **Next 15 and 16.** In last week's npm downloads, 16 was 72% of `next` and 15 was 21%, almost all
  of it 15.5, which still gets backports. Next 16 works under both bundlers. Next 15 works with
  webpack, its default for `next build` and for `next dev` without `--turbopack`. Next 15 with
  Turbopack doesn't work (see below), and Next 15's `create-next-app` put `--turbopack` in the dev
  script, so the docs must tell Next 15 users to drop that flag.

## Where things stand

`@seedprotocol/vite` (`packages/vite/src/index.ts`, about 1,300 lines) is the only supported bundler
integration. For webpack there is a 25-line `withSeed(config, webpack, isServer)` in two places:
`packages/sdk/src/node/webpack/index.ts` (exported from `@seedprotocol/sdk/node`) and the private
`packages/webpack`. Nothing covers Turbopack, which Next 16 uses by default for `next dev` and
`next build`. Turbopack doesn't run webpack plugins; it reads `turbopack.resolveAlias`,
`turbopack.rules` and the rest of `next.config`.

## What the spike found

The spike installs the SDK from packed tarballs into a plain App Router app and runs `next dev` and
`next build && next start` under both bundlers, on Next 16.4.2 and 15.5.28. Each run creates an
item, reloads, and checks the item is still there, in Playwright's Chromium.

With the SDK fixes below, this config is enough for that round trip, including OPFS persistence:

- `fs`, `node:fs`, `fs/promises`, `node:fs/promises` aliased to `@zenfs/core` /
  `@zenfs/core/promises` in browser builds only: `turbopack.resolveAlias` with the `browser`
  condition, and `resolve.alias` in webpack's client compiler. The SDK's browser entry imports
  `fs` (`src/imports/markdown.ts`), and the Vite plugin aliases it to ZenFS the same way.
- `headers()`: COOP `same-origin`, COEP `credentialless`, CORP `same-origin` on `/:path*`. Next
  applies these to `/_next/static` too, and they hold under `next start`.

| Next | Bundler | dev | build + start |
|---|---|---|---|
| 16.4.2 | Turbopack | works | works |
| 16.4.2 | webpack | works | works |
| 15.5.28 | webpack | works | works |
| 15.5.28 | Turbopack | init fails | init fails |

Most of the Vite plugin isn't needed. With no polyfill config, no `global`/`process` shims, no
pre-bundling lists and no `debug`, `nanoid-dictionary`, arweave or EAS interop fixes, both bundlers
handled every CommonJS dependency the round trip touches. Prerendering the page, which renders
`SeedProvider` and `SeedClientGate` on the server, doesn't throw. Not tested: publishing, images,
`@seedprotocol/feed` (which pulls `sax` / `stream`), and multi-tab.

### Fixed in the SDK and React packages

These are committed on the branch. The full test suite passed with them (2,311 tests, plus the
package suites and repo checks), and the SDK's Node consumer check still passes.

- **`'use client'` on `@seedprotocol/react`.** Importing `SeedProvider` into `app/layout.tsx`, a
  server component, failed the build with `TypeError: createContext is not a function`. The React
  build now prepends the directive to `dist/index.js`, and the spike layout imports `SeedProvider`
  directly with no wrapper file.
- **Node platform out of browser bundles.** `platformClassesInit.ts` imported both platforms
  dynamically, so browser bundles shipped the Node platform as a lazy chunk: 153 KB gzipped under
  Turbopack, 52 KB under webpack, including `@libsql/client`. The Node branch now imports
  `#seed-node-platform`, a `package.json` `imports` entry that maps to the browser platform under
  the `browser` condition. The runtime `isBrowser()` check still chooses the platform, so jsdom keeps
  the browser platform as before. Turbopack's client chunks went from 4.3 MB to 3.9 MB and contain
  no libsql code. The Node-only `filesDir` setup now imports bare `fs`/`path` instead of `node:`
  specifiers, so webpack no longer needs a `node:`-stripping plugin.
- **`@seedprotocol/vite` is an optional peer.** It was a runtime dependency only for the
  `@seedprotocol/sdk/vite` re-export, so every SDK install brought Vite 8, Rolldown and
  `vite-plugin-node-polyfills`. A Next app no longer gets any of them. This is a breaking change for
  apps that import `@seedprotocol/sdk/vite` without installing `@seedprotocol/vite`.

### Next 15 with Turbopack

Two separate problems; neither is in Seed code.

1. `next build --turbopack` fails parsing `@libsql/hrana-client/LICENSE` as JavaScript. It comes
   from the server-rendering graph, which resolves `#seed-node-platform` to the Node platform.
   `serverExternalPackages` doesn't help. Aliasing `#seed-node-platform` to
   `dist/platform.browser.js` in `turbopack.resolveAlias` makes the build pass (see
   `spikes/next15-app/next.config.mjs`).
2. At runtime, in dev and production, Next 15's Turbopack starts workers from a `blob:` URL of its
   own (`getWorkerBlobURL` in its runtime) and gives SQLite the root-relative WASM URL
   `/_next/static/media/sqlite3.*.wasm`, which can't be resolved inside a blob worker. SQLite fails
   to load, sqlocal falls back to a memory driver, and init fails on the first migration. Next 16's
   Turbopack doesn't use blob workers.

The spike first blamed the SDK's own blob-wrap in `createSqlocalDrizzle.ts` for (2). That was
wrong: the wrap only applies to `http(s)` module worker URLs, and Turbopack's worker URL is already
`blob:`. A shim for the wrap was tried and reverted.

### Smaller notes

- Every init logs a `SQLITE_CONSTRAINT_UNIQUE` warning on an insert into `models` or `properties`,
  under both bundlers and in prod and dev. Not Next-specific as far as the spike shows; worth
  checking whether Vite apps log it too.
- The desktop app's built-in browser can't start a worker from inside another worker over `http:`,
  so SQLite's OPFS proxy worker fails there and storage silently falls back to memory. Real
  Chromium is fine. Use Playwright for this kind of check.
- The plain webpack 5 plugin (outside Next) and Rspack were not tested.

## Packages (built)

- **`@seedprotocol/next`** (`packages/next`): `withSeed(nextConfig, options)` takes a config object
  or function and returns the same kind. It adds the browser-only `fs` → ZenFS aliases to
  `turbopack.resolveAlias` and to webpack's client compiler, points `#seed-node-platform` and
  `@seedprotocol/query` at their browser builds in every graph (server rendering included), and
  wraps `headers()` with the isolation headers. The user's aliases, `webpack` function and headers
  are kept and win where they overlap. It warns under Next 15 with Turbopack (Next 15 sets
  `TURBOPACK=1` before loading the config). Peer `next >=15.5`. Options: `isolationHeaders`,
  `headersSource`, `fsModules`.
  The browser-entry aliases came out of building the integration fixture inside the monorepo:
  bun's store layout made webpack's server build try to bundle libsql's native binaries, and
  Turbopack warned that `@seedprotocol/query`'s Node disk cache made it trace the whole project.
  With the aliases, both bundlers build the fixture with no warnings.
- **`@seedprotocol/bundler-core`** (`packages/bundler-core`, private): isolation header defaults and
  merge helpers, and the `fs` module list. Built with `tsc`; the Vite and Next builds inline it, so
  it's never a runtime dependency. Synced to the release version because published manifests list
  it in `devDependencies`.
- **Plain webpack**: no separate package. Outside Next, the client config is the two `fs` aliases.
- The private `packages/webpack` is removed, and `withSeed` from `@seedprotocol/sdk/node` is marked
  deprecated in favor of `@seedprotocol/next`.

Also in this round, the SDK's Node-only `filesDir` resolution moved from `platformClassesInit.ts`
into the Node platform (`resolveFilesDir`, exported by both platform entries; the browser one
returns its input). It used `fs` with computed paths, which made Next trace the whole project.

Tests: 19 unit tests for config composition, and an integration test that builds
`packages/next/__tests__/fixtures/next-app` with Turbopack and with webpack, checks the headers on a
page and a static chunk, and runs the create-reload round trip in Playwright (about 30 seconds).

## Steps

1. ~~Spike~~ (done).
2. ~~SDK and React fixes~~ (done; see above).
3. ~~Rerun the spike~~ (done; the table above is the rerun).
4. ~~Extract the shared core~~ (done).
5. ~~`@seedprotocol/next`~~ (done).
6. **Docs and release**: done so far: package README, a Next.js section in
   `docs/GETTING_STARTED.md`, `## Unreleased` changelog notes for next, sdk and react, and the
   package added to version sync, publish order, the tier-1 check, root build/test scripts and both
   CI workflows. Left: a first publish of `@seedprotocol/next` through the release pipeline (it has
   never been on npm, so check `scripts/release.js` handles a package with no prior version).

## Open questions

- Rspack: test it, or leave it unclaimed?
- Safari and `COEP: credentialless`: the hosting docs should say what Safari users need, once
  verified.
- `packages/vite/README.md` tells users to call `configure({ mounts: { '/': IndexedDB } })` in
  their entry, while `VITE_RENDERER.md` and the `autoInit` docstring say `client.init()` mounts OPFS
  itself. The spike app never configured ZenFS and persistence worked, which supports
  `VITE_RENDERER.md`. Fix the README before copying it.
