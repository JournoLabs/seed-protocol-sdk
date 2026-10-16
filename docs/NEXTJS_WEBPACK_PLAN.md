# Next.js and webpack support: plan

Status: draft, 2026-10-16. Nothing here is built yet.

## Where things stand

`@seedprotocol/vite` (`packages/vite/src/index.ts`, about 1,300 lines) is the only supported bundler integration. What exists for webpack is a 25-line `withSeed(config, webpack, isServer)` in two places: `packages/sdk/src/node/webpack/index.ts` (exported from `@seedprotocol/sdk/node`) and the private, "experimental" `packages/webpack`. It strips `node:` prefixes, aliases `fs` to `@zenfs/core` and `path` to `path-browserify` on the client, and externalizes `@sqlite.org/sqlite-wasm`, `chokidar` and `arweave` on the server. The last app that used it, `../seed-test-nextjs`, is Next 14 against a 2024 SDK. Treat it as a starting point, not as working code.

Two facts shape the design:

1. **Next 16 builds with Turbopack by default**, for `next dev` and `next build`. Webpack is opt-in (`--webpack`). Turbopack doesn't run webpack plugins; it only reads `turbopack.resolveAlias`, `turbopack.rules` (a subset of webpack loaders) and the rest of `next.config`. A webpack-only helper would not apply to most new Next apps.
2. **Next renders client components on the server.** A Vite SPA never runs SDK code in Node; a Next app does, on every SSR pass, unless the code is gated. Some of the work is in the SDK and `@seedprotocol/react`, not in bundler config.

## What the Vite plugin does, and what each piece becomes

Most of the Vite plugin works around Vite's dev-time ESM serving and Rolldown pre-bundling. Webpack and Turbopack bundle CommonJS natively, so several items should disappear. The spike (step 1) confirms which.

| Vite plugin piece | Why it exists | Next / webpack equivalent |
|---|---|---|
| COOP/COEP/CORP headers on dev and preview servers | OPFS and SQLite WASM need cross-origin isolation | `async headers()` in `next.config`. Unlike Vite, this also covers `next start` in production. Static export (`output: 'export'`) still needs host headers, same as Vite. Plain webpack: `devServer.headers`. |
| `fs` → ZenFS aliases | SDK browser code imports `fs` | Client-only alias. Webpack: `resolve.alias` in the client compiler. Turbopack: `resolveAlias` with a `{ browser: ... }` conditional so the server keeps real `fs`. |
| Node polyfills (`buffer`, `path`, `events`, `util`, `string_decoder`) and the `stream` stub | Vite ships none | Next provides client fallbacks for most Node core modules in both bundlers. Likely nothing to do; verify. Plain webpack 5 needs `resolve.fallback` entries. |
| Inline `global` / `process` script in `index.html` | CJS wrappers evaluate before module polyfills load | Webpack's `node.global` / `ProvidePlugin`; Next already defines `process.env.*`. No HTML injection (Next has no `index.html`). |
| `optimizeDeps.include` lists, `debug` and `nanoid-dictionary` shims, `EAS__factory` fix | Vite serves raw CJS to the browser in dev | Expected to be unnecessary: webpack and Turbopack handle CJS. Keep the spike app importing these paths to prove it. |
| `arweave` shim | Arweave's ESM entry breaks in Vite | Check whether arweave's `browser` field resolves correctly in both bundlers. |
| `resolve.dedupe` for React, xstate, Seed packages, ZenFS | Two module instances break shared state (`DuplicateEasModuleError`, "App DB not found") | Alias each package to the single path resolved from the app root (webpack `resolve.alias`, Turbopack `resolveAlias`). Mostly matters for linked/monorepo installs. |
| `better-sqlite3` external | Node-only native binding | Client: alias to `false`. Server: `serverExternalPackages`. |
| `worker.format: 'es'` | sqlocal's worker uses code splitting | Webpack 5 and Turbopack both handle `new Worker(new URL(..., import.meta.url), { type: 'module' })`. Verify with sqlocal. |
| `server.fs.allow` for linked SDK paths | Vite dev server sandbox | No equivalent needed. |
| `FileManager` `path-browserify` import rewrite | Default-import interop | Probably unnecessary; verify. If needed, fix the SDK source instead of rewriting in a plugin. |
| Bare-globals warning in `generateBundle` | Catch `process`/`Buffer` leaks before runtime | Port as a webpack `processAssets` hook (reuse `findDangerousGlobals`). Turbopack has no hook for it; skip there. |
| `autoInit` ZenFS script | Legacy | Don't port. `client.init()` mounts OPFS itself. |

## Work the bundler config can't do

**The SDK pulls its Node platform into client bundles.** `platformClassesInit.ts:89-92` picks a platform at runtime with `await import('../../platform/index.browser')` or `import('../../platform/index.node')`. Bundlers follow both dynamic imports, so a client build tries to bundle `index.node`, which imports `child_process`, `@libsql/client`, `drizzle-orm/libsql/migrator`, `@seedprotocol/eas/node` and `@seedprotocol/arweave/node`. Vite gets away with it through externals and polyfills. In Next this means either a long list of client aliases to `false` or, better, an SDK change: route the platform choice through a `package.json` `imports` entry (`#platform` with `browser` / `node` conditions) kept external in the SDK's own build, so each bundler resolves only one side. That benefits Vite too. The `./platform` export already has those conditions; main code doesn't use it.

**`@seedprotocol/react` has no `'use client'` boundary.** Only `OPFSImage.tsx` carries the directive. `SeedProvider` is the first thing an App Router app puts in `app/layout.tsx`, which is a server component, so importing it there fails. The React build needs `'use client'` at the top of its output chunks (a Rolldown banner, or per-entry), and the package should be checked for module-scope browser access.

**SSR of client components.** Even with the directive, `SeedProvider` and the hooks run once on the server. `client.init()` must never start there. `SeedClientGate` and `useIsClientReady` probably cover the render side; confirm nothing at module scope touches `window`, OPFS or workers. Document `dynamic(() => import(...), { ssr: false })` as the fallback for apps that hit something we miss.

**Server-side SDK use** (route handlers, server components reading seeds) is a separate question: it would run the Node platform with libsql inside Next's server. Out of scope for the first release; note it as unsupported and make sure the server build doesn't break if the SDK is imported there by accident.

## Package shape

Recommended: two published packages built on a shared core.

- **`@seedprotocol/next`**: `withSeed(nextConfig, options)` returning a new `NextConfig`. It composes the user's existing `webpack` function, merges into `turbopack.resolveAlias` and `turbopack.rules`, wraps `headers()`, and appends to `serverExternalPackages` and `transpilePackages`. Same option names as Vite where they mean the same thing (`isolationHeaders`, `fsModules`, `debug`). Peer dependency `next >=16` (decide whether to support 15, which still defaults to webpack).
- **`@seedprotocol/webpack`**: a `SeedWebpackPlugin` class (`apply(compiler)`) for plain webpack 5 apps, and the piece `withSeed` uses for Next's webpack mode. Writing it against the public compiler API should make it work under Rspack too; test that, then claim it.
- **Shared core** (private workspace package, inlined into both at build time so it never becomes a runtime dependency): package resolution including the bun nested-install candidates (`resolvePackageFile`, `pushBunPackageCandidates`), the shared-state package list, isolation header defaults and `findDangerousGlobals`. Move these out of `packages/vite/src/index.ts` so the three integrations can't drift. Check that `scripts/check-internal-deps` and `check-browser-entry-graph.js` accept an inlined private package.

The alternative is one `@seedprotocol/webpack` package with a `/next` subpath. Fewer packages, but Next users search for "next", and the Turbopack half has nothing to do with webpack.

Retire the old helpers: deprecate `withSeed` from `@seedprotocol/sdk/node` (keep it one release, re-exporting or warning), and replace the private `packages/webpack` contents rather than keeping both.

## Steps

1. **Spike.** Create a Next 16 App Router fixture (`packages/next/__tests__/fixtures/next-app`) that imports `SeedProvider`, inits the client, creates and reads an item, and loads an image through `SeedImage`. Run `next dev` and `next build && next start` under Turbopack and under `--webpack`. Record every failure. This turns the "verify" cells in the table into a concrete list and probably shrinks the work considerably.
2. **SDK and React fixes** found by the spike: `#platform` split, `'use client'` on the React build, SSR guards. These land first because they change what the config has to do. Each needs the Vite consumer test (`packages/vite/__tests__/integration/consumer.test.ts`) to stay green.
3. **Extract the shared core** from the Vite plugin, with no behavior change.
4. **`@seedprotocol/webpack`** plugin, tested with a plain webpack 5 fixture build.
5. **`@seedprotocol/next`** `withSeed`, Turbopack first since it's the default. Unit tests for config composition (user `webpack` fn still called, user headers win over ours as in Vite, user aliases not shadowed), plus an integration test that builds the fixture both ways and checks the response headers and a client-side item round trip in a browser.
6. **Docs and release**: README per package, a Next section in `docs/GETTING_STARTED.md`, production hosting notes (static export, Vercel headers, Safari not supporting `COEP: credentialless`), changelog entries, and the release pipeline's package list.

## Open questions

- Minimum Next version: 16 only, or 15 as well?
- Should Rspack support be stated, or left untested?
- Is server-side SDK use in Next (route handlers, server components) something PermaPress or others need soon? If yes, it changes the `serverExternalPackages` work from "don't break" to "make it run".
- `packages/vite/README.md` tells users to call `configure({ mounts: { '/': IndexedDB } })` in their entry, while `VITE_RENDERER.md` and the `autoInit` docstring say `client.init()` mounts OPFS and apps shouldn't configure ZenFS. The README looks stale; fix it before copying it for the new packages.
