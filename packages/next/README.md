# @seedprotocol/next

[![npm](https://img.shields.io/npm/v/@seedprotocol/next.svg)](https://www.npmjs.com/package/@seedprotocol/next)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Next.js config helper for apps that use [`@seedprotocol/sdk`](https://www.npmjs.com/package/@seedprotocol/sdk) in the browser. It works with Turbopack (the Next.js 16 default) and webpack.

Use the SDK only in the browser in a Next.js app: in client components, initialized through `SeedClientGate` or `client.init()` in an effect. Server-side use (route handlers, server components reading seeds) isn't supported.

## Installation

```bash
npm install @seedprotocol/sdk @seedprotocol/react @zenfs/core@2.7.7 @zenfs/dom@1.2.14
npm install -D @seedprotocol/next
```

Pin the ZenFS versions the SDK declares so only one copy is installed. `next` 15.5 or later is a peer dependency.

## Usage

```js
// next.config.mjs
import { withSeed } from '@seedprotocol/next'

export default withSeed({
  // your Next.js config
})
```

`withSeed` also accepts a config function and returns one. `@seedprotocol/react` is a client module, so `app/layout.tsx` can render `SeedProvider` directly:

```tsx
// app/layout.tsx
import { SeedProvider } from '@seedprotocol/react'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SeedProvider>{children}</SeedProvider>
      </body>
    </html>
  )
}
```

Pass `SeedClientGate` an `onInitError` callback from a client component; a server component can't pass functions.

## What it configures

- **Browser entries in every graph**: Next.js also bundles client components for server rendering, where Node conditions would pick the SDK's Node platform (libsql and native bindings) and `@seedprotocol/query`'s Node entry. `withSeed` points both at their browser builds in server and client graphs, so server builds don't bundle libsql or trace the whole project.
- **Cross-origin isolation headers** through `headers()`: `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: credentialless` and `Cross-Origin-Resource-Policy: same-origin` on `/:path*`. They apply under `next dev` and `next start`.

Your own aliases, `webpack` function and headers are kept. Where they set the same alias or header, yours win.

## Options

```js
withSeed(nextConfig, {
  isolationHeaders: true,
  headersSource: '/:path*',
  fsModules: [],
})
```

| Option | Default | Description |
|--------|---------|-------------|
| `isolationHeaders` | `true` | `false` adds no headers; `{ coop, coep, corp }` overrides individual values. |
| `headersSource` | `'/:path*'` | Path pattern the headers apply to, in `headers()` `source` syntax. |
| `fsModules` | `[]` | Modules aliased to ZenFS (`@zenfs/core`, or `@zenfs/core/promises` for ids containing "promises") in browser builds, for app code or other dependencies that import `fs` in the browser. The SDK doesn't. For example `['fs', 'fs/promises', 'node:fs', 'node:fs/promises']`. Server builds keep Node's `fs`. |

The options type is exported as `SeedNextOptions`.

## Next.js 15

Next.js 15 works with webpack: `next build`, and `next dev` without `--turbopack`. Remove `--turbopack` from your dev script if `create-next-app` added it. Under Next.js 15's Turbopack, SQLite WASM can't load in the browser (Turbopack starts workers from `blob:` URLs and gives SQLite a WASM URL that can't be resolved there), so the SDK fails to initialize; `withSeed` logs a warning when it detects that setup.

## Production hosting

`next start` sends the headers. A static export (`output: 'export'`) has no Next.js server, so your host must send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless` (or `require-corp`) on the HTML documents.

## License

MIT
