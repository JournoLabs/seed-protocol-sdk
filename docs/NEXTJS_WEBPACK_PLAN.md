# Next.js and webpack support: plan

Status: spike and SDK fixes done 2026-10-16 on `feat/next-integration`, not merged or released.
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

## Package shape

Recommended: `@seedprotocol/next` with `withSeed`, and a shared core with the Vite plugin.

- **`@seedprotocol/next`**: `withSeed(nextConfig, options)` returning a new `NextConfig`. It adds
  the browser-only `fs` aliases to `turbopack.resolveAlias` and to the client compiler in a
  composed `webpack` function (calling the user's), and wraps `headers()` so the user's own
  COOP/COEP/CORP values win, as the Vite plugin does. Option names match Vite where they mean the
  same thing (`isolationHeaders`, `fsModules`, `debug`). Peer `next >=15.5`. On Next 15 with
  Turbopack it should warn that SQLite won't load and point at webpack.
- **Plain webpack**: the client-side config is now two aliases, so a separate
  `@seedprotocol/webpack` package isn't worth it yet. Export the webpack function from
  `@seedprotocol/next`, or document the aliases, and split it out only if someone asks for
  non-Next webpack support.
- **Shared core**: isolation header defaults and the `fs` module list, moved out of
  `packages/vite/src/index.ts` so the integrations can't drift. Small enough that a module inlined
  into both packages at build time is enough; check that `scripts/check-internal-deps.js` and
  `check-browser-entry-graph.js` accept it.

Retire the old helpers: deprecate `withSeed` from `@seedprotocol/sdk/node` for one release, and
replace the contents of the private `packages/webpack`.

## Steps

1. ~~Spike~~ (done).
2. ~~SDK and React fixes~~ (done; see above).
3. ~~Rerun the spike~~ (done; the table above is the rerun).
4. **Extract the shared core** from the Vite plugin, with no behavior change.
5. **`@seedprotocol/next`**: `withSeed` with unit tests for config composition (user `webpack`
   function still called, user headers win, user aliases not shadowed) and an integration test that
   turns the spike app into a fixture: build under both bundlers, check the response headers, run
   the probe's create-reload round trip in Playwright.
6. **Docs and release**: package README, a Next section in `docs/GETTING_STARTED.md` that states
   the browser-only recommendation and the Next 15 webpack requirement, production hosting notes
   (static export needs host headers; Safari doesn't support `COEP: credentialless`), changelog
   entries including the `@seedprotocol/vite` peer change, and the release pipeline's package list.

## Open questions

- Rspack: test it, or leave it unclaimed?
- `packages/vite/README.md` tells users to call `configure({ mounts: { '/': IndexedDB } })` in
  their entry, while `VITE_RENDERER.md` and the `autoInit` docstring say `client.init()` mounts OPFS
  itself. The spike app never configured ZenFS and persistence worked, which supports
  `VITE_RENDERER.md`. Fix the README before copying it.
