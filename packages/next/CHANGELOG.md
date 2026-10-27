# @seedprotocol/next

## 0.7.12 (2026-10-27)

- New `dir` option: the directory `withSeed` resolves the SDK and `next` from, and makes Turbopack alias paths relative to. Pass the config file's directory when Next.js runs from somewhere else (a monorepo root). It defaults to `process.cwd()`, which skipped the aliases in that case.
- The package description and README no longer name ZenFS as a requirement: it is needed only with `fsModules`. The README says to remove `--turbopack` from both the `dev` and `build` scripts on Next.js 15.

### Commits

#### Fixes

- dir option; README and description drop ZenFS as required; --turbopack in build (b64a6099)

## 0.7.11 (2026-10-24)

No user-facing changes; released at the same version as the other packages.

## 0.7.10 (2026-10-24)

### Commits

#### Fixes

- sdk: load without Iterator helpers (ZenFS 2.7.7) (f88840eb)

## 0.7.9 (2026-10-22)

No user-facing changes; released at the same version as the other packages.

## 0.7.8 (2026-10-20)

No user-facing changes; released at the same version as the other packages.

## 0.7.7 (2026-10-18)

- First release. `withSeed(nextConfig, options)` adds the config `@seedprotocol/sdk` needs in the browser under Turbopack and webpack: the SDK's Node platform and `@seedprotocol/query`'s Node entry replaced by their browser builds in server-rendering graphs, and cross-origin isolation headers through `headers()`. `fsModules` aliases `fs` specifiers to ZenFS in browser builds for apps that need it; the SDK doesn't. Supports Next.js 16, and Next.js 15.5 with webpack; warns under Next.js 15 with Turbopack, where SQLite WASM can't load.
