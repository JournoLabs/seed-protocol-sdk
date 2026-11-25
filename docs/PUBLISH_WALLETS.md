# Publish wallets

`@seedprotocol/publish` publishes through a `PublishWallet`: a `SeedSigner` that signs and a `SeedTxSender` that submits transactions. Any wallet stack that can fill those two interfaces works. Vendor SDKs stay outside the core entry; `thirdweb` is an optional peer used only by `@seedprotocol/publish/thirdweb` ([ADR 0027](./adr/0027-publish-depends-on-wallet-interfaces.md)).

```ts
type PublishWallet = {
  signer: SeedSigner      // signMessage, optional signTypedData
  txSender: SeedTxSender  // sendTransaction, optional waitForReceipt
  kind?: 'eoa' | 'smart' | 'modular'
}
```

`kind` says what account publishes. Publish refuses a publisher with no contract code when `kind` is unset, because an undeployed smart account and an EOA look the same on chain.

| `kind` | Publishes from | Attests with |
|---|---|---|
| `'eoa'` | The signer's own address | Direct EAS; `multiPublish` sent to itself when delegated to the Seed delegate, or when the EIP-7702 sender delegates it there on this send; `multiPublish` too if the address has other contract code |
| `'smart'` | A smart account whose signatures are EIP-1271/6492 | `multiPublish` |
| `'modular'` | A ManagedAccount administered by an EOA signer | `multiPublish` |

## Adapters

| Adapter | Wallet | Notes |
|---|---|---|
| `fromEip1193Provider(provider, options?)` | MetaMask, Rabby, other injected wallets | Asks for accounts unless `address` is passed |
| `fromWindowEthereum(options?)` | `window.ethereum` | Throws when it isn't there |
| `fromViemWalletClient(walletClient, options?)` | wagmi, RainbowKit, ConnectKit, Reown AppKit | Needs a client with an account |
| `fromPrivyWallet(wallet, options?)` | Privy embedded or external wallets | Switches to the publish chain, then takes the provider |
| `fromEthersWallet(wallet)` | ethers `Wallet` | Scripts and servers |
| `fromThirdwebAccount(account)` | Thirdweb `Account` | From `@seedprotocol/publish/thirdweb` |

All of these send from the wallet's own address, and the user pays gas. They return `kind: 'eoa'`, except that `fromThirdwebAccount` leaves it for the caller to set. The EIP-1193, viem and Privy adapters take `chain` and `kind`.

The package doesn't depend on wagmi or Privy. `fromViemWalletClient` takes a viem `WalletClient`, and `fromPrivyWallet` takes any object with Privy's `address`, `chainId`, `switchChain` and `getEthereumProvider`.

```tsx
const { connect } = useSeedWallet()

const { data: walletClient } = useWalletClient()   // wagmi
if (walletClient) await connect(fromViemWalletClient(walletClient))

const { wallets } = useWallets()                   // Privy
await connect(await fromPrivyWallet(wallets[0]))
```

`fromViemWalletClient` doesn't switch chains. viem throws `ChainMismatchError` when a JSON-RPC wallet is on another chain, so switch it to the publish chain first. `fromPrivyWallet` switches once, when it is called; call it again if the app moves the wallet to another chain.

A connector whose account is a smart contract wallet (Coinbase Smart Wallet, Safe) needs `{ kind: 'smart' }`. Its signatures don't verify as Arweave data items, so register a `dataItemSigner` that holds a plain ECDSA key:

```ts
await setPublishWallet({
  ...fromViemWalletClient(walletClient, { kind: 'smart' }),
  dataItemSigner: uploadKey.signer,
})
```

## Who sends

`initPublish` selects the sender:

| Config | Sender | Gas |
|---|---|---|
| Neither of the below | The wallet | The user |
| `accountMode: 'eip7702'` with `bundlerUrl` | `createPermissionlessTxSender` (EntryPoint v0.8) | Paymaster, unless `payment.gas` is `'user'` |
| `useModularExecutor: true` | A ManagedAccount sender | See below |

`useSeedWallet().connect` and `ensureWalletThenPublish` apply the EIP-7702 sender to whatever wallet is connected.

The EIP-7702 sender needs one signature a plain wallet connection can't give. An EOA's first UserOp carries an authorization delegating it to the Simple7702 account, or to the Seed delegate when one is configured, signed by `SeedSigner.signAuthorization`. `fromEthersWallet` and local viem accounts implement that. Browser wallets don't expose it over EIP-1193, so for those adapters pass the wallet vendor's call as the `signAuthorization` option. Without one, the first send from an undelegated EOA throws before reaching the bundler. Later sends don't need it.

With a Seed delegate (`seedDelegateAddress`, or the known deployment for the chain), the EIP-7702 sender delegates EOAs to it instead of Simple7702Account, and moves an EOA already on Simple7702Account there on its next send when its signer has `signAuthorization`; one whose signer doesn't stays on Simple7702Account and attests directly ([ADR 0040](./adr/0040-eoas-publish-through-a-seed-eip7702-delegate.md)). Those EOAs publish with `multiPublish` sent to their own address, so references within one publish are linked as on a ManagedAccount, and the EOA is the attester. Before the first send, the simulation and gas estimate run the delegate's code at the EOA, and the cost estimate adds 25,000 gas for the authorization. `checking` fails the publish with `PUBLISH_PREFLIGHT_FAILED` when the delegate's `getEas()` isn't the configured EAS. An EOA delegated to any other account, such as a wallet vendor's, is refused with `EIP7702_DELEGATED_ELSEWHERE` and never re-delegated. No Seed delegate is deployed yet, so no chain has a default.

With `useModularExecutor`, publish uses a registered wallet that sends as its `publisherAddress` with a different signer. Any other wallet goes to the Thirdweb in-app flow, which needs the `thirdweb` peer.

### Who pays

The EIP-7702 sender asks the paymaster at `paymasterUrl` to sponsor each UserOp. When it declines, the send fails with `PublishGasError` code `SPONSOR_DECLINED`, unless the app lets users pay their own gas:

```ts
initPublish({
  bundlerUrl,
  paymasterUrl,
  payment: {
    whenSponsorDeclines: 'user',
    confirmSelfPay: async ({ address, reason }) => window.confirm(`Pay the gas from ${address}?`),
  },
})
```

With `whenSponsorDeclines: 'user'`, a decline resends the same UserOp without a paymaster, under the same nonce, so the EOA pays from its own ETH. `confirmSelfPay` is asked first; resolving `false` or throwing fails the send with `SELF_PAY_REFUSED`, and leaving it out lets self-pay go ahead. An EOA without enough ETH fails with `SELF_PAY_INSUFFICIENT_FUNDS`.

A decline is a JSON-RPC error answered by `paymasterUrl`, or the bundler's `AA31` (paymaster deposit too low). A paymaster that can't be reached (network error, timeout, HTTP error), or that answers an internal error, a rate limit or method not found, fails the send with `SPONSOR_UNREACHABLE` and never falls back, so an outage or a wrong `paymasterUrl` doesn't charge users. Only a failure of the send itself falls back: once the bundler accepts the UserOp, a later error is reported as it is. Because a JSON-RPC error is told apart from a bundler error by its URL, `initPublish` throws `PublishPaymentConfigError` unless `paymasterUrl` is set and differs from `bundlerUrl`. Every `PublishGasError` leaves the attempt not sent, so a retry sends again and reuses the uploads.

Without more config the decline is found at the send, after the uploads. Set `payment.sponsorPaymaster` to the paymaster's address to ask earlier: before any upload, the publish reads its EntryPoint v0.8 deposit, and when that is under twice the publish's estimated gas cost, asks `confirmSelfPay` with reason `'deposit_low'` and `estimatedCostWei`. A refusal stops the publish before it uploads anything. Without `confirmSelfPay`, or when the deposit or gas price can't be read, the publish skips this check. If the user agrees, the send still tries the sponsor first and asks again if it declines. `getSponsorStatus()` and the `useSponsorStatus()` hook read the same deposit, for showing it in the app.

## ManagedAccount without Thirdweb

A ManagedAccount is Thirdweb's account contract with Seed's executor extension. `createManagedAccountTxSender` sends from one through any ERC-4337 bundler that serves EntryPoint v0.6, using standard RPC and no Thirdweb SDK. Paymasters are asked with ERC-7677 `pm_getPaymasterStubData` and `pm_getPaymasterData`; `sponsored: false` skips them, and the account pays its own gas.

```ts
initPublish({
  uploadApiBaseUrl,
  rpcUrl,
  chain,
  useModularExecutor: true,
  modularAccountModuleContract,
})

const owner = fromViemWalletClient(walletClient)
const txSender = await createManagedAccountTxSender({
  signer: owner.signer,
  bundlerUrl,
  paymasterUrl,
})

// Set up once per account. The first UserOp deploys it; the install needs the deployed account.
await txSender.sendTransaction({ to: owner.signer.address, data: '0x' })
await ensureExecutorModuleInstalled(txSender.address, async () => owner, {
  modularAccountModuleContract,
})

await setPublishWallet({
  signer: owner.signer,
  txSender,
  kind: 'modular',
  publisherAddress: txSender.address,
})
```

Use `setPublishWallet` here, not `useSeedWallet().connect`, which sets `publisherAddress` to the signer. Without `publisherAddress`, publish takes the Thirdweb path.

Without `managedAddress`, the sender uses the account the signer administers through the factory. The factory is `managedAccountFactoryAddress`, or the chain's built-in one.

`ensureExecutorModuleInstalled` does nothing for an undeployed account, and publish doesn't run it on this path, so do the setup before the first publish. The account's admin EOA must send `installSeedExecutor` itself, because the extension rejects it as a self-call. That one transaction goes through the wallet rather than the bundler, so the admin needs gas for it. Once the executor is installed, the call sends nothing.

`enrollPublishAutomation` runs the same install when given `admin`. See [PUBLISH_AUTOMATION.md](./PUBLISH_AUTOMATION.md#enroll) for session keys.

## Bundlers and paymasters

Core publish uses standard RPC, so a provider needs no adapter. Two EntryPoint versions are in play:

| Sender | EntryPoint | Bundler config |
|---|---|---|
| `createManagedAccountTxSender` | v0.6 | `bundlerUrl` option |
| `createPermissionlessTxSender` | v0.8 | `PublishConfig.bundlerUrl` |
| Thirdweb in-app wallets | v0.6 | `PublishConfig.thirdweb.bundlerUrl` |

Check that a provider still accepts v0.6 UserOps on your chain before choosing it for a ManagedAccount. Fees come from `pimlico_getUserOperationGasPrice` when the bundler answers it, and otherwise from the chain's estimate; `estimateFeesPerGas` on `createManagedAccountTxSender` replaces both.

Both senders are tested in CI against Alto and a test paymaster behind an ERC-7677 service, on a fork of OP Sepolia with the real factory, EntryPoints and Simple7702Account ([TESTING.md](./TESTING.md#account-abstraction-stack-tests)). They have not been run against a hosted provider.
