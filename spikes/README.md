# Next.js spike apps

Throwaway apps from the Next.js integration spike (2026-10-16). The decisions it led to are in
[ADR 0013](../docs/adr/0013-nextjs-browser-only-through-next-package.md). Not part of the workspace or CI.

`next-app` runs Next 16.4.2 and `next15-app` runs Next 15.5.28. Both have the same App Router
page and the same `next.config.mjs`. The page inits the client through `SeedClientGate`, creates
a `Note` item and lists items. The apps install the SDK from tarballs, the way an npm user would.

Build the packages and pack the tarballs from the repo root:

```bash
node scripts/build-with-tests.js -f "bun run sync-versions && bun run build:eas && bun run build:arweave && bun run build:query && bun run build:feed && bun run build:feed-hyper && bun run build:gateway-hyper && bun run build:vite && bun run --filter @seedprotocol/sdk build:dev && bun run build:react"
```

```bash
for p in sdk react eas arweave query vite; do (cd packages/$p && bun pm pack --destination ../../spikes/tarballs --quiet); done
```

Then `npm install` in an app directory and use its scripts. Set `SPIKE_DIST` to keep webpack and
Turbopack output apart (for example `SPIKE_DIST=.next-webpack npm run build:webpack`).

`probe.mjs` drives Playwright's Chromium against one or more running servers. It creates a note,
reloads, and prints the item count before and after along with console errors:

```bash
node spikes/probe.mjs http://localhost:3458 http://localhost:3459
```

Use the probe, not the desktop app's built-in browser. The built-in browser can't start a worker
from inside another worker over `http:`, so SQLite's OPFS worker fails there and the database
silently falls back to memory.
