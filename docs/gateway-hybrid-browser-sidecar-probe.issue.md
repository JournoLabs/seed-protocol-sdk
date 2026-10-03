# Issue: hybrid / hyper gateway resolution probes the desktop sidecar from public web origins

**Status:** open, not scheduled. Logged 2026-10-03 while handling PermaPress's "read our gateway
first" change request (which shipped as `setPreferredArweaveReadBaseUrls` /
`gateway.preferredReadBaseUrls`). Not blocking: PermaPress works around it.

## What happens

`resolveSeedGatewayEndpoints` (`packages/arweave/src/gateway/resolveSeedGatewayEndpoints.ts`)
handles `transport: 'hybrid'` as proxy → sidecar → public HTTP. When `proxyBaseUrl` is unset or its
`/info` probe fails, it probes the local Hyper sidecar at `http://127.0.0.1:1984` (or
`hyper.localSidecarHost:localSidecarPort`). `transport: 'hyper'` does the same with no public
fallback. Neither checks where it is running.

From a browser page on a public origin (e.g. `https://app.example.com`, or a dev origin like
`https://local.app.permapress.xyz:43844`) that probe:

- is a public → loopback request, which Chrome's Private Network Access rules preflight or block
  and other browsers may prompt for;
- puts a failed request and console error on every cold start for the vast majority of visitors,
  who don't run the sidecar;
- adds up to the probe timeout to client init when the proxy is down;
- when it does succeed, silently routes that one visitor's uploads and GraphQL through their own
  desktop sidecar instead of the app's proxy, which the app developer probably didn't intend.

`probeSidecar: false` avoids the sidecar probe. But it also turns off the proxy health check, so a
proxy that is down gets adopted anyway. That makes it a trade-off rather than a fix.

## Current workaround

PermaPress resolves endpoints itself (`permapress/packages/app/src/helpers/resolvePermapressSeedGatewayEndpoints.ts`):
it probes only its app-server proxy, adopts it with `probeSidecar: false` or falls back to HTTP
without a sidecar attempt, and initialises the Seed client on plain `http-gateway`. Every other web
app using `hybrid` would need the same code.

## Related: proxy / sidecar paths have no public read fallback

`getReadGatewayHostsForConfig` returns only the proxy or sidecar host when that path is active, so
a read that the proxy can't serve never reaches the public gateways. `preferredReadBaseUrls`
removes the need to use these paths just to read your own gateway first, but apps that do use them
still have no fallback. Worth fixing together, now that reads can be a list of base URLs with mixed
schemes (`getArweaveReadBaseUrls`).

## Suggested fix

1. In the browser, skip the sidecar step unless the page origin is itself loopback (`localhost`,
   `127.0.0.1`, `[::1]`, `*.localhost`), or an explicit opt-in such as
   `hyper.probeSidecarFromBrowser: true` is set (Electron / desktop shells).
2. Split `probeSidecar` into separate proxy and sidecar switches, keeping `probeSidecar` as the
   shorthand for both.
3. For `http-proxy` / `hyper-sidecar`, append the public gateways after the active host in
   `getReadGatewayHostsForConfig`'s read list. Generate full base URLs so an `http` sidecar can sit
   in front of `https` public hosts.
4. Tests in `packages/arweave/__tests__/gateway/resolveSeedGatewayEndpoints.test.ts`: stub
   `window.location`, assert no request to `127.0.0.1:1984` from a public origin, and assert a probe
   is still made from `http://localhost:5173`.

Once this lands, PermaPress can drop its own resolver and use `transport: 'hybrid'` with
`proxyBaseUrl`.
