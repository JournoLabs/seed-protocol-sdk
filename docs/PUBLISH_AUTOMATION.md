# Publish Automation Grants

SDK support for **ManagedAccount-hosted**, revocable publish/revoke automation. App developers (e.g. PermaPress) hold a session key; the user keeps the ManagedAccount identity and can revoke the grant at any time.

Modular-account-as-identity is **out of scope** for this version.

## Trust model

| Role | Address | Custody |
|------|---------|---------|
| **Identity / EAS attester** | User’s ManagedAccount | User only |
| **Automation session key** | App-generated secp256k1 | App server (never Seed Protocol) |
| **Arweave DataItem owner** | Same session key (recommended) | App server |

- On-chain policy: Thirdweb session key on the ManagedAccount with `approvedTargets` = **executor module only** (`modularAccountModuleContract`). Not the ManagedAccount itself, not raw EAS (those allow `setEas` / arbitrary attestations).
- Discoverability: revocable EAS sidecar `seedprotocol.publishAuthorization`, attested by the ManagedAccount, recipient = session key.
- **Publish can change canonical heads** (patch / `new_version`). A live grant may supersede prior property attestations. Scope is publish + revoke only — not key rotation, `setEas`, or adding other signers.

```text
User (owner)
  └── ManagedAccount (attester)
        ├── addSessionKey / removeSessionKey (user)
        ├── executor module (multiPublish / multiRevoke)
        └── PublishAuthorization sidecar (user-attested)
Automation session key ──UserOp──► module only
Automation session key ──ANS-104──► Arweave
```

## Prerequisites

1. `initPublish` / `PublishProvider` with:
   - `useModularExecutor: true` (typical)
   - **`modularAccountModuleContract`** set to the Seed executor module
2. User’s ManagedAccount is **ModularCore** (module install must succeed). Enrollment **fails loudly** if the module cannot be installed.
3. App generates and stores a session keypair offline; only the **address** is passed into enroll.

## Enroll

```ts
import { initPublish, fromEthersWallet, PublishManager } from '@seedprotocol/publish'
import {
  enrollPublishAutomation,
} from '@seedprotocol/publish/thirdweb'
import { ethers } from 'ethers'

initPublish({
  thirdwebClientId: '...',
  uploadApiBaseUrl: '...',
  useModularExecutor: true,
  modularAccountModuleContract: '0xYourExecutorModule',
})

// Server-generated key (store privately)
const automationWallet = ethers.Wallet.createRandom()

const { authorization } = await enrollPublishAutomation({
  managedAddress: userManagedAccountAddress,
  sessionKeyAddress: automationWallet.address,
  appAddress: optionalAppLabelAddress,
  expiresAt: Math.floor(Date.now() / 1000) + 90 * 24 * 3600, // optional
  // userWallet: fromThirdwebAccount(managedAccount) // or omit to use connected managed in-app wallet
})

// Persist authorization.uid for later revokePublishAutomation
```

Steps performed:

1. Ensure executor module installed on ManagedAccount (fail if not ModularCore).
2. `addSessionKey` with module-only `approvedTargets`.
3. Attest `seedprotocol.publishAuthorization` (ManagedAccount attester).

## Unattended publish / revoke

On-chain publish/revoke for automation keys must go through the **ManagedAccount as a UserOp**, with call target = **executor module only** (`modularAccountModuleContract`). `createAttestations` detects an active session key on the ManagedAddress, keeps your provided `PublishWallet`, and routes `multiPublish` to that module (same pattern as `prepareEasMultiRevoke`).

```ts
import { PublishManager, fromEthersWallet } from '@seedprotocol/publish'
import type { PublishWallet } from '@seedprotocol/publish'

const automationWallet = /* app-held ethers.Wallet */

// DataItems: same session key can sign ANS-104 via fromEthersWallet (EOA personal_sign).
const dataItemWallet = fromEthersWallet(automationWallet)

// On-chain: pass a PublishWallet whose txSender submits UserOps as this session key
// on the ManagedAccount (e.g. Thirdweb account with session key, or a custom SeedTxSender).
// fromEthersWallet alone sends plain EOA txs and is not sufficient for AA session-key UserOps.
const onChainWallet: PublishWallet = /* session-key UserOp PublishWallet */

PublishManager.createPublish(item, managedAddress, onChainWallet, {
  dataItemSigner: dataItemWallet.signer,
})

// Unpublish uses the registered revoke executor + prepareEasMultiRevoke
// (targets the executor module when modularAccountModuleContract is set)
await item.unpublish() // with setPublishWallet(onChainWallet) / initPublish configured
```

**Prerequisites for unattended `multiPublish`:**

1. Executor module installed; session key enrolled with module-only `approvedTargets`
2. ManagedAccount `getEas` already matches publish config (automation keys cannot `setEas`)
3. `PublishWallet.txSender` can submit ManagedAccount UserOps signed by the session key

Readers should treat **EAS attester (ManagedAccount)** as authorship. Bind Arweave owners with:

```ts
import { assertStorageBoundToIdentity } from '@seedprotocol/publish/thirdweb'

const { bound, via } = await assertStorageBoundToIdentity({
  managedAddress,
  dataItemOwner: recoveredDataItemOwnerAddress,
})
```

## Disconnect

```ts
import { revokePublishAutomation } from '@seedprotocol/publish/thirdweb'

await revokePublishAutomation({
  managedAddress,
  sessionKeyAddress: automationWallet.address,
  authorizationUid: authorization.uid,
})
```

Removes the session key on-chain, then revokes the sidecar. After revoke, the keypair may still sign Arweave bytes; readers must not treat them as that identity.

## APIs

### `@seedprotocol/eas`

- `PUBLISH_AUTHORIZATION_*`, `decodePublishAuthorizationData`, `assessPublishAuthorization`
- `getPublishAuthorizationFromEas({ identities?, sessionKeys?, apps? })`

### `@seedprotocol/publish`

- `ensurePublishAuthorizationSchema`, `attestPublishAuthorization`, `revokePublishAuthorization`
- `assessPublishAuthorizationLive`

### `@seedprotocol/publish/thirdweb`

- `approvedTargetsForAutomationPublish`, `ensureAutomationSessionKey`, `removeAutomationSessionKey`, `isAutomationSessionActive`
- `enrollPublishAutomation`, `revokePublishAutomation`
- `assertStorageBoundToIdentity`
- `buildAutomationSessionKeyPermissions`, `hashAutomationSessionKeyPermissions`

## Integrator checklist

- [ ] Generate per-user (or per-app) session keys; never reuse Seed Protocol keys
- [ ] Call `enrollPublishAutomation` only with the **user’s** ManagedAccount wallet connected
- [ ] Store `authorization.uid` + session key securely; rotate by revoke + re-enroll
- [ ] Set grant `expiresAt` when appropriate
- [ ] Ensure ManagedAccount `getEas` matches publish config before unattended publish (automation keys cannot `setEas`)
- [ ] Use a UserOp-capable `PublishWallet` for on-chain txs; `fromEthersWallet` is fine for DataItem signing only
- [ ] Use `assertStorageBoundToIdentity` (or equivalent) before treating Arweave owners as the identity
- [ ] Expose “Disconnect automation” → `revokePublishAutomation`

## Related

- [PUBLISHING.md](./PUBLISHING.md) — publish modes and flows
- [DOMAIN_OWNERSHIP.md](./DOMAIN_OWNERSHIP.md) — sidecar pattern this mirrors
- [ATTESTATION_REVOCATION.md](./ATTESTATION_REVOCATION.md) — unpublish / revoke
