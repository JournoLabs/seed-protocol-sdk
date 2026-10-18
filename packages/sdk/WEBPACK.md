# Webpack / Next.js integration

Use [`@seedprotocol/next`](../next/README.md) for Next.js apps. It covers Turbopack (the Next.js 16 default) and webpack.

`withSeed(config, webpack, isServer)` from `@seedprotocol/sdk/node` is deprecated. It predates the current SDK layout, doesn't cover Turbopack, and doesn't set the cross-origin isolation headers OPFS needs.
