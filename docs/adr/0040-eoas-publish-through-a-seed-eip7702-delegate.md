# 0040. EOAs publish with multiPublish through a Seed EIP-7702 delegate

- **Status:** Proposed
- **Date:** 2026-11-25
- **Scope:** `@seedprotocol/publish` (`PublishConfig.seedDelegateAddress`, `SEED_DELEGATE_ADDRESSES`, the
  permissionless EIP-7702 sender, attestation routing)

## Context

An EOA has no code, so `@seedprotocol/publish` sends its attestations straight to EAS. That path has no
in-batch cross-references: a Post and the author Seed it references can't be created in one call, which
`multiPublish` does on a ManagedAccount. With `accountMode: 'eip7702'` the SDK already delegates EOAs to
eth-infinitism's `Simple7702Account` (`0xe6Cae83BdE06E4c305530e199D7217f42808555B`) and sends UserOps
through an EntryPoint v0.8 bundler, sponsored by an ERC-7677 paymaster or paid by the EOA. That
contract has no `multiPublish`, so those EOAs still attest directly.

The Seed delegate (`SeedPublisher7702` in `seed-protocol`) is `Simple7702Account` plus `multiPublish`
(selector `0xa1263421`) and `getEas()`. `multiPublish` accepts calls only from the account itself and
keeps no storage, with EAS as an immutable. It is not deployed yet.

## Decision

- `PublishConfig.seedDelegateAddress` names the delegate. It defaults to `SEED_DELEGATE_ADDRESSES[chain.id]`,
  which stays empty until the first deploy. Without a delegate, everything works as before.
- With a delegate, the EIP-7702 sender passes it to permissionless as `accountLogicAddress`, so UserOps
  are built and signed exactly as for `Simple7702Account`. An EOA with no code, or delegated to
  `Simple7702Account`, signs an authorization to the Seed delegate on its next send. An EOA delegated
  to anything else (a wallet's own smart account) is refused with `EIP7702_DELEGATED_ELSEWHERE` and
  never re-delegated.
- An EOA that is delegated to the Seed delegate, or will be on this send, attests with `multiPublish`
  sent to its own address. The EOA is the EAS attester. Before the first send, gas estimates and
  simulations override the EOA's code with the delegate's runtime bytecode (`getCode(delegate)`), not
  a `0xef0100` designator, which nodes may not resolve in a state override. EAS is immutable in that
  bytecode and `address(this)` is the EOA, so the simulation matches the real call.
- `checking` fails the publish, before any upload, when the delegate's `getEas()` isn't the configured
  EAS. Before each send, the SDK checks that the delegate's code has the `multiPublish` selector.
- Only a signer that can sign an EIP-7702 authorization moves an EOA to the Seed delegate. An EOA on
  `Simple7702Account` whose signer can't (a browser wallet over EIP-1193) stays there and attests
  through EAS directly, as before.

## Consequences

EOA users get in-batch references and one attestation call per publish, the same as ManagedAccount
users, without deploying an account. The first publish carries the EIP-7702 authorization, which costs
about 25,000 gas more. Accounts moved off `Simple7702Account` lose nothing: neither delegate keeps
storage, and the EntryPoint holds the nonce.

Wallets that delegate EOAs to their own smart account (some browser wallets) can't use this route; they
keep publishing through their own sender or with `accountMode: 'eoa'`.

## Alternatives considered

- **Keep EOAs on direct EAS.** No cross-references within a batch, and two transactions where one
  would do.
- **Deploy a ManagedAccount per EOA.** The attester becomes the account, not the user's address, and
  the deploy costs more than an authorization.
- **Re-delegate any delegated EOA.** Would silently break a wallet vendor's account. Refusing is the
  only safe default.
