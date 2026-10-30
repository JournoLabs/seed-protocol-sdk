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
| `'eoa'` | The signer's own address | Direct EAS, or `multiPublish` if the address has code |
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

With `useModularExecutor`, publish uses a registered wallet that sends as its `publisherAddress` with a different signer. Any other wallet goes to the Thirdweb in-app flow, which needs the `thirdweb` peer.

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

The ManagedAccount sender has been run against a local Alto bundler and a test paymaster behind an ERC-7677 service. It has not been run against a hosted provider.
