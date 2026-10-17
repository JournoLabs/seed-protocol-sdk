# @seedprotocol/next

## Unreleased

- First release. `withSeed(nextConfig, options)` adds the config `@seedprotocol/sdk` needs in the browser under Turbopack and webpack: `fs` aliased to ZenFS in browser builds, the SDK's Node platform and `@seedprotocol/query`'s Node entry replaced by their browser builds in server-rendering graphs, and cross-origin isolation headers through `headers()`. Supports Next.js 16, and Next.js 15.5 with webpack; warns under Next.js 15 with Turbopack, where SQLite WASM can't load.
