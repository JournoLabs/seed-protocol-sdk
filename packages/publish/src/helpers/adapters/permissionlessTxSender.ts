import type { Address, Hex, LocalAccount, SignableMessage, SignedAuthorization } from 'viem'
import { createPublicClient, http } from 'viem'
import { createPaymasterClient, entryPoint08Address } from 'viem/account-abstraction'
import { createSmartAccountClient } from 'permissionless'
import { to7702SimpleSmartAccount } from 'permissionless/accounts'
import {
  brandTxSender,
  requireSignTypedData,
  type SeedSigner,
  type SeedTxRequest,
  type SeedTxSender,
} from '../seedSigner'
import { getPublishRpcUrl, getPublishViemChain } from '../chainConfig'
import { isManagedAccountPublishError, PublishGasError } from '../../errors'
import type { SelfPayRequest } from '../../payment'
import { pinnedNonce } from '../pinnedNonce'
import { classifySponsorFailure, isInsufficientPrefund } from './sponsorDecline'
import { assertUserOpSucceeded, bundlerFeesPerGas } from './userOps'

export type CreatePermissionlessTxSenderOptions = {
  signer: SeedSigner
  bundlerUrl: string
  /** Sponsoring paymaster, asked with ERC-7677 `pm_getPaymasterStubData` / `pm_getPaymasterData`. Defaults to `bundlerUrl`. */
  paymasterUrl?: string
  /** `false` sends without a paymaster: the account pays its own gas. Default `true`. */
  sponsored?: boolean
  /**
   * Asked when the paymaster declines a sponsored UserOp (a JSON-RPC error from `paymasterUrl`, or
   * `AA31`). Resolving `true` resends the same UserOp, under the same nonce, without a paymaster,
   * paid by the account. Without it, a decline throws `PublishGasError` `SPONSOR_DECLINED`.
   */
  onSponsorDeclined?: (request: SelfPayRequest) => Promise<boolean>
}

export function seedSignerToLocalAccount(signer: SeedSigner): LocalAccount {
  return {
    address: signer.address,
    type: 'local',
    source: 'custom',
    publicKey: '0x',
    signMessage: async ({ message }: { message: SignableMessage }) =>
      signer.signMessage({ message }),
    signTransaction: async () => {
      throw new Error(
        '@seedprotocol/publish: permissionless EIP-7702 path does not use signTransaction',
      )
    },
    signTypedData: async (args) =>
      requireSignTypedData(signer)(args as Parameters<NonNullable<SeedSigner['signTypedData']>>[0]),
  }
}

/**
 * Throws when the bundler lists its EntryPoints and v0.8 is not among them (e.g. a local twin's
 * v0.6 bundler, which belongs in `PublishConfig.thirdweb.bundlerUrl`). Bundlers that do not
 * answer `eth_supportedEntryPoints` are let through.
 * @internal Exported for unit tests.
 */
export async function assertBundlerSupportsEntryPoint08(bundlerUrl: string): Promise<void> {
  let supported: unknown
  try {
    const res = await fetch(bundlerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_supportedEntryPoints', params: [] }),
    })
    supported = ((await res.json()) as { result?: unknown }).result
  } catch {
    return
  }
  if (!Array.isArray(supported)) return
  const list = supported.map((a) => String(a).toLowerCase())
  if (list.includes(entryPoint08Address.toLowerCase())) return
  throw new Error(
    `@seedprotocol/publish: PublishConfig.bundlerUrl (${bundlerUrl}) does not support EntryPoint v0.8 (it lists ${list.join(', ') || 'none'}). ` +
      `The top-level bundlerUrl is only for the permissionless EIP-7702 sender. For Thirdweb in-app wallets (e.g. a local twin's bundler), set PublishConfig.thirdweb.bundlerUrl instead.`,
  )
}

/**
 * The authorization a UserOp from an undelegated EOA must carry. viem's prepareUserOperation only
 * fills in a stub, which bundlers reject, so the caller has to sign the real one.
 * @internal Exported for unit tests.
 */
export async function authorizationForUserOp(params: {
  signer: SeedSigner
  delegate: Address
  chainId: number
  isDelegated: () => Promise<boolean>
  getNonce: () => Promise<number>
}): Promise<SignedAuthorization | undefined> {
  const { signer, delegate, chainId } = params
  if (await params.isDelegated()) return undefined
  if (typeof signer.signAuthorization !== 'function') {
    throw new Error(
      `@seedprotocol/publish: ${signer.address} hasn't delegated to an EIP-7702 account yet, and its signer has no signAuthorization to do so. Browser wallets don't expose it over EIP-1193: pass the wallet vendor's call as signAuthorization, or use accountMode: 'eoa'.`,
    )
  }
  return signer.signAuthorization({ address: delegate, chainId, nonce: await params.getNonce() })
}

/**
 * EIP-7702 `SeedTxSender` via permissionless `to7702SimpleSmartAccount`, sponsored by a paymaster
 * unless `sponsored` is false.
 * @throws when `bundlerUrl` reports no EntryPoint v0.8 support
 */
export async function createPermissionlessTxSender(
  options: CreatePermissionlessTxSenderOptions,
): Promise<SeedTxSender> {
  const { signer, bundlerUrl, paymasterUrl, sponsored = true } = options
  await assertBundlerSupportsEntryPoint08(bundlerUrl)
  const chain = getPublishViemChain()
  const rpcUrl = getPublishRpcUrl()
  const address = signer.address as Address

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  })

  const owner = seedSignerToLocalAccount(signer)

  const simpleAccount = await to7702SimpleSmartAccount({
    client: publicClient,
    owner,
    entryPoint: {
      address: entryPoint08Address,
      version: '0.8',
    },
  })

  const clientFor = (withPaymaster: boolean) =>
    createSmartAccountClient({
      account: simpleAccount,
      chain,
      bundlerTransport: http(bundlerUrl),
      ...(withPaymaster ? { paymaster: createPaymasterClient({ transport: http(paymasterUrl ?? bundlerUrl) }) } : {}),
      userOperation: {
        estimateFeesPerGas: bundlerFeesPerGas(bundlerUrl, () => publicClient.estimateFeesPerGas()),
      },
    })
  const smartAccountClient = clientFor(sponsored)
  const selfPayClient = sponsored && options.onSponsorDeclined ? clientFor(false) : undefined

  /**
   * After a sponsored `sendUserOperation` failed: throws `PublishGasError` for a decline or an
   * unreachable sponsor, or resends without a paymaster when `onSponsorDeclined` agrees. Only
   * errors from `sendUserOperation` come here: a declined op never reached the bundler's mempool,
   * so the resend can't land twice.
   */
  const afterSponsoredSendFailed = async (
    err: unknown,
    resend: (client: NonNullable<typeof selfPayClient>) => Promise<Hex>,
  ): Promise<Hex> => {
    if (!sponsored) throw err
    const failure = classifySponsorFailure(err, { paymasterUrl: paymasterUrl ?? bundlerUrl, bundlerUrl })
    if (!failure) throw err
    if (failure === 'unreachable') {
      throw new PublishGasError(
        `The paymaster at ${paymasterUrl ?? bundlerUrl} couldn't be reached, so ${address}'s publish wasn't sent.`,
        'SPONSOR_UNREACHABLE',
        address,
        err,
      )
    }
    if (!selfPayClient || !options.onSponsorDeclined) {
      throw new PublishGasError(
        `The paymaster declined to sponsor ${address}'s publish${failure === 'deposit_low' ? ' (its deposit is too low)' : ''}. ` +
          "Set payment.whenSponsorDeclines: 'user' to let users pay their own gas.",
        'SPONSOR_DECLINED',
        address,
        err,
      )
    }
    const agreed = await options.onSponsorDeclined({ address, reason: failure }).catch(() => false)
    if (agreed !== true) {
      throw new PublishGasError(`The paymaster declined and ${address} didn't agree to pay the gas.`, 'SELF_PAY_REFUSED', address, err)
    }
    try {
      return await resend(selfPayClient)
    } catch (selfPayErr) {
      if (isInsufficientPrefund(selfPayErr)) {
        throw new PublishGasError(
          `The paymaster declined and ${address} doesn't hold enough ETH to pay the gas itself.`,
          'SELF_PAY_INSUFFICIENT_FUNDS',
          address,
          selfPayErr,
        )
      }
      throw selfPayErr
    }
  }

  return brandTxSender({
    address: (simpleAccount.address ?? address) as Address,
    pinsNonceOn: entryPoint08Address,
    sendTransaction: async (tx: SeedTxRequest) => {
      const authorization = await authorizationForUserOp({
        signer,
        delegate: simpleAccount.authorization.address,
        chainId: chain.id,
        isDelegated: () => simpleAccount.isDeployed(),
        getNonce: () => publicClient.getTransactionCount({ address }),
      })
      // Read once: viem draws a new nonce key on each send that has none, and a self-paid resend
      // must keep the declined op's nonce.
      const nonce =
        tx.nonceKey !== undefined ? pinnedNonce(tx.nonceKey) : selfPayClient ? await simpleAccount.getNonce() : undefined
      const send = (client: typeof smartAccountClient) =>
        client.sendUserOperation({
          calls: [{ to: tx.to, data: tx.data, value: tx.value ?? 0n }],
          ...(nonce !== undefined && { nonce }),
          ...(authorization && { authorization }),
        })
      try {
        let hash: Hex
        try {
          hash = await send(smartAccountClient)
        } catch (err) {
          hash = await afterSponsoredSendFailed(err, send)
        }
        const receipt = await smartAccountClient.waitForUserOperationReceipt({ hash })
        return { transactionHash: assertUserOpSucceeded(receipt, simpleAccount.address) }
      } catch (err) {
        if (isManagedAccountPublishError(err) || err instanceof PublishGasError) throw err
        const msg = err instanceof Error ? err.message : String(err)
        throw new Error(
          `@seedprotocol/publish: permissionless/EIP-7702 send failed (${msg}). Ensure bundlerUrl/paymasterUrl support EntryPoint v0.8, or use accountMode: 'eoa' / Thirdweb adapter.`,
          { cause: err },
        )
      }
    },
  })
}
