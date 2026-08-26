## 0.5.0

### Changed

- Extracted `@seedprotocol/eas` and `@seedprotocol/arweave` Tier-1 packages; SDK re-exports preserve the public API.
- `drizzle-orm` and `xstate` are now peer dependencies (consumers must declare them explicitly).
- Removed unused runtime deps: `globals`, `ethers`, `better-sqlite3` (Vite-only references moved to devDependencies).
