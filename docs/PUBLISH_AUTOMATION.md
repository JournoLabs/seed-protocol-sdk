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
        ├── Seed executor (multiPublish only; no revoke)
        └── PublishAuthorization sidecar (user-attested)
Automation session key ──UserOp──► module only
Automation session key ──ANS-104──► Arweave
```

## Prerequisites

1. `initPublish` / `PublishProvider` with:
   - `useModularExecutor: true` (typical)
   - **`modularAccountModuleContract`** set to the Seed executor module
2. The executor must be able to act for the ManagedAccount: `isInitialized(account)` is true and `getEAS(account)` matches `easContractAddress`. Enroll installs it:
   - Router ManagedAccounts (the default Thirdweb `ManagedAccountFactory`) with the `SeedExecutorRouterExtension`: `installSeedExecutor()`, sent by the user's in-app EOA (the account admin). The extension rejects it as a self-call, so the smart account can't send it itself.
   - ModularCore ManagedAccounts: `installModule`.
   - Router accounts without the extension can't run the executor; enroll rejects them with `AUTOMATION_UNSUPPORTED_ACCOUNT` before adding a session key.
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

1. Install the executor (`installSeedExecutor` from the admin EOA, or `installModule` on ModularCore).
2. Check that the module can act for the account. Otherwise throw `ManagedAccountPublishError` with code `AUTOMATION_UNSUPPORTED_ACCOUNT`, before anything is written on-chain.
3. `addSessionKey` with module-only `approvedTargets`.
4. Attest `seedprotocol.publishAuthorization` (ManagedAccount attester).

## Server / Node

A browser `thirdwebClientId` is usually locked to app origins. From a server, Thirdweb RPC and the bundler return 401 until `initPublish` includes `thirdwebSecretKey`. Schema reads go through a separate viem client: pass a public `rpcUrl`, or pass `thirdwebClientId` and `thirdwebSecretKey` together so those reads send `x-secret-key`. The secret does not build the RPC URL by itself.

`fromThirdwebAccount(account, { client })` uses a client you already created. Other contract calls still use `getClient()`, which reads `thirdwebSecretKey` / `thirdwebClientId` from `initPublish`.

Node does not start `PublishManager` on import. `await PublishManager.ready()` starts it and resolves when the machine value is `active` (`snapshot.status` is not that signal). `createPublish` returns a promise of the spawned actor (`undefined` if it did not start). That promise settles when the process is spawned. `getPublish` keeps the last finished actor, including a fast failure, until the next publish of that seed.

eas-sdk 2.10’s ESM build named-imports CommonJS `lodash`, which Node rejects. Start the process with `node --import @seedprotocol/sdk/node-eas-lodash`. The hook loads `lodash-es` (the ESM package) for those eas-sdk imports only.

```ts
initPublish({
  thirdwebClientId: process.env.THIRDWEB_CLIENT_ID,
  thirdwebSecretKey: process.env.THIRDWEB_SECRET_KEY,
  rpcUrl: process.env.RPC_URL,
  uploadApiBaseUrl: process.env.UPLOAD_API_BASE_URL,
  useModularExecutor: true,
  modularAccountModuleContract: '0xYourExecutorModule',
})

await PublishManager.ready()
```

### Creating items in Node

Pass every value to `Item.create`. Text, Number, Boolean, Date, Json, Relation and List values are written as given. Html, Image and File values go through the property's save pipeline before `Item.create` resolves: Html is written to `files/html` and the property's value becomes the storage seed id that publish uploads to Arweave. A value that is already a storage seed id (local id or `0x` uid) is kept as is. Types are matched case-insensitively, so a schema with `"list"` or `"html"` works without mapping.

```ts
const post = await Item.create({
  modelName: 'Post',
  title,
  slug,
  html,                                  // raw HTML string
  authors: authorItems.map((a) => a.seedLocalId),
})
```

`Item.create` rejects if any Html, Image or File value fails to save. The error names the property and the item's `seedLocalId`. The item itself already exists at that point.

To change a value later, assign it and await the save. `ItemProperty.save()` rejects with the save error, or with `ItemPropertySaveValidationError` when the value fails the schema's validation rules.

```ts
const htmlProperty = post.allProperties['html']
htmlProperty.value = updatedHtml
await htmlProperty.save()
```

`post.html = updatedHtml` also starts a save, but returns nothing to await. Use the property when the next step depends on the save.

`createNewItem` is the low-level writer and stores values verbatim. Don't pass it Html, Image or File content. Publish validation rejects such an item with `publish_storage_value_not_saved`.

## Unattended publish / revoke

On-chain publish for automation keys must go through the **ManagedAccount as a UserOp**, with call target = **executor module only** (`modularAccountModuleContract`). `createAttestations` detects an active session key on the ManagedAddress, keeps your provided `PublishWallet`, and routes `multiPublish` to that module.

Automation keys **cannot revoke attestations**. The Seed contracts make revocation owner-only (`execute(EAS, multiRevoke)` from the ManagedAccount), and the executor has no revoke. `revokeAttestations` throws for an automation key before sending anything. `revokePublishAutomation` (removing the key and revoking the sidecar) is signed by the user and is unaffected.

Before each automation publish UserOp, the SDK:

1. Checks that the module can act for the account (`AUTOMATION_UNSUPPORTED_ACCOUNT` if not).
2. Simulates the call from the ManagedAccount with `eth_call`. A call that would revert, or a simulation that can't run, throws `AUTOMATION_PREFLIGHT_FAILED` with the decoded revert reason, and nothing is sent.

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

await PublishManager.ready()
const actor = await PublishManager.createPublish(item, managedAddress, onChainWallet, {
  dataItemSigner: dataItemWallet.signer,
})

// Unpublish uses the registered revoke executor + prepareEasMultiRevoke
// (targets the executor module when modularAccountModuleContract is set)
await item.unpublish() // with setPublishWallet(onChainWallet) / initPublish configured
```

**Prerequisites for unattended `multiPublish`:**

1. Executor module installed and initialized for the ManagedAccount; session key enrolled with module-only `approvedTargets`
2. The module's `getEAS(account)` already matches publish config (automation keys cannot change it)
3. `PublishWallet.txSender` can submit ManagedAccount UserOps signed by the session key
4. EAS schemas for the item’s models and properties are already registered. Automation keys cannot call SchemaRegistry or EAS, so they cannot register or name a missing schema. While the owner wallet is connected (the same wallet used for `enrollPublishAutomation`), call `ensureEasSchemasForItem(item, userWallet)` once. After those schemas exist, unattended publish only reads the registry. A missing schema fails before the UserOp with `schema "…" is not registered; automation keys can't register schemas`.

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
- `assertExecutorModuleReadyForAccount` (check an account before offering enrollment), `simulateCallFromAccount`

### `@seedprotocol/publish/thirdweb`

- `approvedTargetsForAutomationPublish`, `ensureAutomationSessionKey`, `removeAutomationSessionKey`, `isAutomationSessionActive` (`false` when the ManagedAccount has no bytecode; throws if a deployed account’s `isActiveSigner` read fails)
- `enrollPublishAutomation`, `revokePublishAutomation`
- `assertStorageBoundToIdentity`
- `buildAutomationSessionKeyPermissions`, `hashAutomationSessionKeyPermissions`

## Integrator checklist

- [ ] Generate per-user (or per-app) session keys; never reuse Seed Protocol keys
- [ ] Call `enrollPublishAutomation` only with the **user’s** ManagedAccount wallet connected
- [ ] Store `authorization.uid` + session key securely; rotate by revoke + re-enroll
- [ ] Set grant `expiresAt` when appropriate
- [ ] Handle `AUTOMATION_UNSUPPORTED_ACCOUNT` from enroll (Router accounts without the executor extension) and `AUTOMATION_PREFLIGHT_FAILED` from publish
- [ ] Revoke attestations with the user's wallet, not the automation key
- [ ] Register content schemas once with the owner wallet via `ensureEasSchemasForItem` (automation keys cannot register schemas)
- [ ] Use a UserOp-capable `PublishWallet` for on-chain txs; `fromEthersWallet` is fine for DataItem signing only
- [ ] Use `assertStorageBoundToIdentity` (or equivalent) before treating Arweave owners as the identity
- [ ] Expose “Disconnect automation” → `revokePublishAutomation`

## Related

- [PUBLISHING.md](./PUBLISHING.md) — publish modes and flows
- [DOMAIN_OWNERSHIP.md](./DOMAIN_OWNERSHIP.md) — sidecar pattern this mirrors
- [ATTESTATION_REVOCATION.md](./ATTESTATION_REVOCATION.md) — unpublish / revoke
