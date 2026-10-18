# @seedprotocol/next

## 0.7.7 (2026-10-18)

- First release. `withSeed(nextConfig, options)` adds the config `@seedprotocol/sdk` needs in the browser under Turbopack and webpack: the SDK's Node platform and `@seedprotocol/query`'s Node entry replaced by their browser builds in server-rendering graphs, and cross-origin isolation headers through `headers()`. `fsModules` aliases `fs` specifiers to ZenFS in browser builds for apps that need it; the SDK doesn't. Supports Next.js 16, and Next.js 15.5 with webpack; warns under Next.js 15 with Turbopack, where SQLite WASM can't load.
