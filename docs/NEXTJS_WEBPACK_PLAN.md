# Next.js and webpack support: plan

Status: spike done 2026-10-16; nothing shipped yet. Spike apps and how to rerun them are in
[spikes/README.md](../spikes/README.md).

## Decisions

- **Browser only.** We recommend using the SDK only in the browser in Next apps. No server-side
  support (route handlers, server components reading seeds) until a real user brings a use case
  with details. The integration only has to keep server builds from breaking.
- **Next 15 and 16.** In last week's npm downloads, 16 was 72% of `next` and 15 was 21%, almost all
  of it 15.5, which still gets backports. Next 15 builds with webpack by default, and that path
  works with the same config as 16 (see below), so supporting 15 costs little. Turbopack on 15 is
  covered once the SDK fixes below land; until then document webpack for 15.

## Where things stand

`@seedprotocol/vite` (`packages/vite/src/index.ts`, about 1,300 lines) is the only supported bundler
integration. For webpack there is a 25-line `withSeed(config, webpack, isServer)` in two places:
`packages/sdk/src/node/webpack/index.ts` (exported from `@seedprotocol/sdk/node`) and the private
`packages/webpack`. Nothing covers Turbopack, which Next 16 uses by default for `next dev` and
`next build`. Turbopack doesn't run webpack plugins; it reads `turbopack.resolveAlias`,
`turbopack.rules` and the rest of `next.config`.

## What the spike found

The spike installed the SDK from packed tarballs (0.7.4 plus local main) into a plain App Router
app and ran `next dev` and `next build && next start` under both bundlers, on Next 16.4.2 and
15.5.28. Each run created an item, reloaded, and checked the item was still there, in Playwright's
Chromium.

This config is enough for the browser round trip, including OPFS persistence:

- `turbopack.resolveAlias`: `fs`, `node:fs`, `fs/promises`, `node:fs/promises` aliased to
  `@zenfs/core` / `@zenfs/core/promises` under the `browser` condition only.
- `webpack()`, client compiler only: a `NormalModuleReplacementPlugin` that strips the `node:`
  prefix (webpack otherwise fails with `UnhandledSchemeError` on `node:crypto`, `node:fs`,
  `node:path`), and the same `fs` aliases.
- `headers()`: COOP `same-origin`, COEP `credentialless`, CORP `same-origin` on `/:path*`. Next
  applies these to `/_next/static` too, and they hold under `next start`.

| Next | Bundler | dev | build + start |
|---|---|---|---|
| 16.4.2 | Turbopack | works | works |
| 16.4.2 | webpack | works | works |
| 15.5.28 | webpack (default) | not run | works |
| 15.5.28 | Turbopack | init fails | build fails |

Most of the Vite plugin isn't needed. With no polyfill config, no `global`/`process` shims, no
pre-bundling lists and no `debug`, `nanoid-dictionary`, arweave or EAS interop fixes, both bundlers
handled every CommonJS dependency the round trip touches. Prerendering the page, which renders
`SeedProvider` and `SeedClientGate` on the server, didn't throw. The sqlocal and SQLite workers and
the WASM file were emitted and loaded under both bundlers. Not tested: publishing, images,
`@seedprotocol/feed` (which pulls `sax` / `stream`), and multi-tab.

The problems are mostly in the SDK and React packages, not in bundler config:

1. **`SeedProvider` can't be imported in a server-component layout.** `app/layout.tsx` is a server
   component by default; importing `SeedProvider` there fails the build with
   `TypeError: createContext is not a function`. `@seedprotocol/react` has no `'use client'`
   directive (only `OPFSImage.tsx` does). The spike works around it with a `providers.tsx`
   client wrapper, which is what every Next user would otherwise have to write.
2. **The SDK's Node platform ships to the browser.** `platformClassesInit.ts` picks the platform
   with `await import('./platform.browser.js')` or `import('./platform.node.js')` at runtime, and
   bundlers follow both. The browser never loads the Node chunk, but it's built and shipped: about
   153 KB gzipped under Turbopack and 52 KB under webpack, including the web build of
   `@libsql/client` and the libsql migrator. It's also why the `fs` and `node:` config above is
   needed for the client at all, and probably why Next 15's Turbopack build fails (it tries to parse
   `@libsql/hrana-client/LICENSE` as JavaScript). Pointing both branches at the existing
   `@seedprotocol/sdk/platform` export, which already has `browser` / `node` conditions, did not fix
   the Next 15 build on its own, so the libsql reference comes from more than that import. Find
   every route from the browser entry to `@libsql/client` before claiming the fix.
3. **The sqlocal blob-wrap breaks relative asset URLs.** `createSqlocalDrizzle.ts` starts sqlocal's
   module worker from a `blob:` URL that imports the real worker (a workaround for Chrome profiles
   that kill HTTPS module workers, commit bda9edb9). Inside a blob worker, root-relative URLs can't
   be resolved: Next 15's Turbopack dev build emits the WASM as `/_next/static/media/sqlite3.*.wasm`
   and the worker's `fetch` fails with "Failed to parse URL". Next 16's Turbopack strips
   `type: 'module'` from workers, so the wrap never applies there, and webpack's output also passed.
   Options: resolve relative URLs against the page origin in the blob source, or only wrap when the
   Chrome failure actually happens.
4. **Installing the SDK installs Vite.** `@seedprotocol/sdk` has a runtime dependency on
   `@seedprotocol/vite` (for the `@seedprotocol/sdk/vite` re-export), which brings
   `vite-plugin-node-polyfills`, and npm installs its `vite` peer, so Vite 8 and Rolldown land in a
   Next app's `node_modules`. Move `@seedprotocol/vite` to an optional peer of the SDK, or drop
   the re-export in the next breaking release.

Smaller notes:

- Every init logs a `SQLITE_CONSTRAINT_UNIQUE` warning on an insert into `models` or `properties`,
  under both bundlers and in prod and dev. Not Next-specific as far as the spike shows; worth
  checking whether Vite apps log it too.
- The desktop app's built-in browser can't start a worker from inside another worker over `http:`,
  so SQLite's OPFS proxy worker fails there and storage silently falls back to memory. Real
  Chromium is fine. Use Playwright for this kind of check.
- The plain webpack 5 plugin (outside Next) and Rspack were not tested.

## Package shape

Recommended: `@seedprotocol/next` for Next, `@seedprotocol/webpack` for plain webpack 5, and a
shared core inlined into both.

- **`@seedprotocol/next`**: `withSeed(nextConfig, options)` returning a new `NextConfig`. It
  composes the user's `webpack` function, merges into `turbopack.resolveAlias`, and wraps
  `headers()` so the user's own COOP/COEP/CORP values win, as the Vite plugin does. Option names
  match Vite where they mean the same thing (`isolationHeaders`, `fsModules`, `debug`). Peer
  `next >=15.5`. After the SDK fixes, the config it adds should be small: the `fs` aliases may
  still be needed for ZenFS, while the `node:` strip should become unnecessary once the Node
  platform is out of the client graph.
- **`@seedprotocol/webpack`**: a `SeedWebpackPlugin` (`apply(compiler)`) holding the client-side
  webpack logic, used by `withSeed` in webpack mode and usable on its own. Given how little the
  webpack path needs, this could start as an export of `@seedprotocol/next` and split out only if
  someone asks for non-Next webpack support.
- **Shared core** (private workspace package, inlined at build time): isolation header defaults,
  the `fs` module list, package resolution including the bun nested-install candidates. Move these
  out of `packages/vite/src/index.ts` so the integrations can't drift. Check that
  `scripts/check-internal-deps.js` and `check-browser-entry-graph.js` accept an inlined package.

Retire the old helpers: deprecate `withSeed` from `@seedprotocol/sdk/node` for one release, and
replace the contents of the private `packages/webpack`.

## Steps

1. ~~Spike~~ (done; see above).
2. **SDK and React fixes**, each with the Vite consumer test
   (`packages/vite/__tests__/integration/consumer.test.ts`) still passing:
   - `'use client'` at the top of `@seedprotocol/react`'s output chunks.
   - Keep the Node platform out of browser graphs. Route platform selection through a conditional
     export or `imports` entry, and trace every other path to `@libsql/client` from the browser
     entry. Done when Next 15.5 `next build --turbopack` passes with the config above and the client
     bundle has no libsql code.
   - Fix the sqlocal blob-wrap for relative asset URLs. Done when Next 15.5 Turbopack dev passes
     the probe.
   - Make `@seedprotocol/vite` an optional peer of the SDK instead of a dependency.
3. **Rerun the spike** against the fixed packages to settle what config `withSeed` still needs.
4. **Extract the shared core** from the Vite plugin, with no behavior change.
5. **`@seedprotocol/next`**: `withSeed` with unit tests for config composition (user `webpack`
   function still called, user headers win, user aliases not shadowed) and an integration test that
   turns the spike app into a fixture: build under both bundlers, check the response headers, run
   the probe's create-reload round trip in Playwright.
6. **Docs and release**: package README, a Next section in `docs/GETTING_STARTED.md` that states
   the browser-only recommendation, production hosting notes (static export needs host headers;
   Safari doesn't support `COEP: credentialless`), changelog entries, and the release pipeline's
   package list.

## Open questions

- Rspack: test it, or leave it unclaimed?
- `packages/vite/README.md` tells users to call `configure({ mounts: { '/': IndexedDB } })` in
  their entry, while `VITE_RENDERER.md` and the `autoInit` docstring say `client.init()` mounts OPFS
  itself. The spike app never configured ZenFS and persistence worked, which supports
  `VITE_RENDERER.md`. Fix the README before copying it.
