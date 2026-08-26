# Webpack / Next.js integration (`@seedprotocol/webpack`)

Use `withSeed()` in Next.js (or other webpack) configs so client bundles can resolve Seed SDK browser shims.

`import { withSeed } from '@seedprotocol/sdk/node'` remains supported for backward compatibility.

## Quick start

```ts
import type { NextConfig } from 'next'
import { withSeed } from '@seedprotocol/webpack'
import webpack from 'webpack'

const nextConfig: NextConfig = {
  webpack(config, { isServer }) {
    return withSeed(config, webpack, isServer)
  },
}

export default nextConfig
```

Install peer dependencies in your app as needed:

- `webpack` (required)
- `@zenfs/core` and `path-browserify` (for client bundle aliases)
