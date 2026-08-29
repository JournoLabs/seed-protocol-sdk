# Webpack / Next.js integration

Use `withSeed` from `@seedprotocol/sdk/node` in Next.js (or other webpack) configs so client bundles can resolve Seed SDK browser shims.

```js
// next.config.mjs
import { withSeed } from '@seedprotocol/sdk/node'
import webpack from 'webpack'

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    return withSeed(config, webpack, isServer)
  },
}

export default nextConfig
```

> `@seedprotocol/webpack` is experimental and private — do not depend on or publish it.
