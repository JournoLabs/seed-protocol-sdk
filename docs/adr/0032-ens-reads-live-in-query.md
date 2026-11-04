# 0032. ENS reads live in query, behind its `ens` subpath

- **Status:** Accepted
- **Date:** 2026-11-04
- **Scope:** `@seedprotocol/query`

## Context

Bloggers who host on IPFS reach their site through an ENS name whose contenthash (EIP-1577) names
a CID. To serve them, a Seed reader has to go from a name such as `alice.eth` to the publication's
Seeds, and show attesters by name rather than address. Reads are all a reader needs; setting a
contenthash is a publish concern and comes later.

ENS resolution is an `eth_call` against the Universal Resolver on Ethereum mainnet (or Sepolia),
with ENSIP-10 wildcard names and CCIP-Read (EIP-3668) gateways on the way. viem's ENS actions
handle both. viem has no contenthash action, so that one call is ours, through the same Universal
Resolver function viem's `getEnsText` uses.

`@seedprotocol/query` reads EAS through GraphQL and Arweave over HTTP; it does not depend on
viem. `@seedprotocol/publish` does. The other place reads could go is a new `@seedprotocol/ens`
package.

## Decision

ENS reads are a module of `@seedprotocol/query` (`packages/query/src/ens/`), exported from the
subpath `@seedprotocol/query/ens` and not from the package root. viem and `multiformats` are
regular dependencies of query; only the `ens` entry imports them, so the root entry's bundle
does not grow.

Every function takes a viem client from the caller (`createPublicClient({ chain: mainnet, ... })`).
query does not pick an RPC URL or chain for ENS, as ENS lives on L1 while Seeds may be attested on
an L2.

The discovery record is the ENSIP-5 text record `io.seedprotocol.publication`, holding JSON:
`schema` (required), `publisher`, `feed`, `chainId`. A reader passes `schema` and `publisher` to
`queryBySchema`. Unknown keys are ignored so the format can grow.

## Consequences

- One package to install for readers; ENS results feed straight into `queryBySchema`.
- query now pulls viem and `multiformats` into `node_modules` for every install, used or not.
- Accepting names in `queryBySchema({ attesters })` needs a client there; it is not done here.
  A caller resolves names first.
- Contenthash writes (recommendation 3 of the IPFS and ENS plan) belong in
  `@seedprotocol/publish`, which owns the wallet interfaces (ADR 0027). Encoding can move to a
  shared place then.

## Alternatives considered

- **A new `@seedprotocol/ens` package.** Clean dependency line, but one more package to version
  and release for five functions, and the main use (name to Seeds) needs query anyway.
- **Exporting from query's root.** Puts viem on the import path of every query user, including
  browser bundles that never touch ENS.
- **Hand-rolled resolver calls.** Loses ENSIP-10 and CCIP-Read handling that viem already has.
