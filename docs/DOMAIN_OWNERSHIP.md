# Domain Ownership Attestation

Tooling for proving DNS control of a domain and sealing a **tool-attested** EAS sidecar (`seedprotocol.domainOwnership`). Mirrors the PublishedBy split: pure helpers and GraphQL reads in `@seedprotocol/eas`, challenge/DNS/RDAP verification and chain writes in `@seedprotocol/publish`.

## Trust model

- A **tool wallet** (allowlisted by clients) verifies the DNS challenge and RDAP snapshot, then attests.
- The attestation’s `recipient` is the **claimer** address bound into the TXT challenge.
- Treat the claim as **“DNS control verified at time T”**, not eternal legal ownership. Registrant contacts are often redacted; ownership-change detection uses registry fingerprint drift (see [Assess](#assess--query)).

## Flow

1. `createDomainOwnershipChallenge({ domain, claimer })` → caller-held challenge (`txtName`, `txtValue`, `token`, `challengeHash`, …).
2. User publishes the TXT record at `_seedprotocol-challenge.<domain>`.
3. `verifyAndAttestDomainOwnership({ challenge, wallet })` → multi-resolver DNS quorum + RDAP snapshot + EAS attest.
4. Clients query with `getDomainOwnershipFromEas({ toolAddresses, domains? })` and optionally `assessDomainOwnershipLive`.

```ts
import {
  createDomainOwnershipChallenge,
  verifyAndAttestDomainOwnership,
  assessDomainOwnershipLive,
  revokeDomainOwnership,
} from '@seedprotocol/publish'
import {
  getDomainOwnershipFromEas,
  decodeDomainOwnershipData,
  assessDomainOwnership,
} from '@seedprotocol/eas'

const challenge = createDomainOwnershipChallenge({
  domain: 'example.com',
  claimer: userAddress,
})
// Show challenge.txtName / challenge.txtValue / challenge.digHint in UI

const { uid, registrySnapshot } = await verifyAndAttestDomainOwnership({
  challenge,
  wallet: toolWallet,
})

const rows = await getDomainOwnershipFromEas({
  toolAddresses: [toolAddr],
  domains: ['example.com'],
})
const live = await assessDomainOwnershipLive({
  uid,
  toolAddresses: [toolAddr],
})
```

## DNS TXT format

- **Name:** `_seedprotocol-challenge.<domain>` (IETF underscore-challenge style; never place the challenge on the apex alone).
- **Value:** `token=<base64url>,addr=<claimer>,expiry=<ISO-8601>`
- Token has ≥128 bits of entropy; default challenge TTL is **72 hours**.
- Domains are normalized to the **registrable** eTLD+1 via `rdapper` / `tldts` unless `normalizeRegistrable: false`.

Verification queries `node:dns` plus Cloudflare and Google DNS-over-HTTPS. Success requires a **DNSSEC-authenticated** match or a **quorum of ≥2** matching sources.

## Schema

Named `seedprotocol.domainOwnership` (revocable):

```text
string domain,address claimer,string method,bytes32 challengeHash,uint64 verifiedAt,string registryCreationDate,string registryExpirationDate,bytes32 registryFingerprint,string scope
```

| Field | Notes |
|-------|--------|
| `method` | Always `dns-txt-challenge` in v1 |
| `challengeHash` | keccak256 of `domain\|claimer\|token\|scope` (raw token never on-chain) |
| `registryFingerprint` | keccak256 of `{ domain, creationDate, registrarIanaId }` |
| `scope` | Default `registrable` |
| EAS `expirationTime` | RDAP `expirationDate` when present; otherwise `verifiedAt + 365 days` |
| EAS `recipient` | Claimer address |

APIs (`@seedprotocol/publish`):

- `ensureDomainOwnershipSchema(wallet)`
- `attestDomainOwnership` / `revokeDomainOwnership`
- `verifyDomainOwnershipChallenge` / `verifyAndAttestDomainOwnership`
- `createDomainOwnershipChallenge` / `verifyDomainOwnershipDns` / `lookupDomainRegistry`

## Assess / query

**Reads (`@seedprotocol/eas`):**

- `getDomainOwnershipFromEas({ toolAddresses, domains?, claimers?, schemaUid?, excludeRevoked })`
- `decodeDomainOwnershipData` / `assessDomainOwnership` (pure)
- `hashDomainOwnershipChallenge` / `hashDomainRegistryFingerprint`

**Live recheck (`@seedprotocol/publish`):**

- `assessDomainOwnershipLive({ uid, toolAddresses })` — re-fetches RDAP and runs `assessDomainOwnership`

| Status | Meaning |
|--------|---------|
| `valid` | Not expired; fingerprint matches when a snapshot is supplied |
| `expired` | Past EAS `expirationTime` or attested registry expiration |
| `likely_transferred` | Live RDAP fingerprint (creation date / registrar IANA id) differs |
| `stale` | Older than soft window (default 365d) with no live registry recheck |
| `unknown` | Registry lookup failed (`registrySnapshot: null`) |

Registrant name changes are **not** used (privacy redaction). Prefer filtering to `valid` for discovery; treat `likely_transferred` as revoke-or-warn.

## Revocation

`revokeDomainOwnership({ wallet, uid })` must be signed by the **tool attester** that created the attestation. There is no automatic background revoke job — apps schedule rechecks via `assessDomainOwnershipLive` and call revoke when appropriate.

## Related

- [PUBLISHING.md](./PUBLISHING.md) — publish flow and PublishedBy sidecar
- [PUBLISH_AUTOMATION.md](./PUBLISH_AUTOMATION.md) — ManagedAccount publish/revoke automation grants
- [ATTESTATION_REVOCATION.md](./ATTESTATION_REVOCATION.md) — Seed unpublish vs tool sidecars
