import { deploySmartAccount, getContract, } from 'thirdweb'
import { getClient } from './publishThirdwebClient'
import { createWallet, Account, inAppWallet, type Wallet, } from 'thirdweb/wallets'
import { useActiveAccount } from 'thirdweb/react'
import { ThirdwebContract, } from 'thirdweb/contract'
import { useEffect, useRef, useState, } from 'react'
import type { Chain } from 'thirdweb/chains'
import type { Address, Hex } from 'viem'
import debug from 'debug'
import {
  getConfigRef,
  getPublishConfig,
  requireManagedAccountFactoryAddress,
  resolveThirdwebWalletOptions,
  type PublishConfig,
} from '../config'
import { MANAGED_ACCOUNT_FACTORY_ADDRESSES } from './constants'
import {
  isContractDeployed,
  pollSmartWalletDeployed as pollDeployed,
} from './chainClient'
import { encodeCreateAccount, readFactoryGetAddress } from './contracts'
import type { PublishWallet } from './seedSigner'
import { getPublishThirdwebChain, isLocalThirdwebChain } from './thirdwebChain'
import { seedPaymaster } from './seedPaymaster'
import { logGas } from './gasLog'

const logger = debug('permaPress:helpers:thirdweb')

/**
 * Custom storage for publish in-app wallets: same prefix for modular (EIP-7702) and managed (EIP-4337).
 * Uses `localStorage` so embedded-wallet session material survives app/tab restarts.
 */
const SEED_IN_APP_SESSION_PREFIX = 'seedProtocol:inAppPublish:'

let _publishInAppWalletStorage: {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
  removeItem: (key: string) => Promise<void>
} | null = null

export function getSharedPublishInAppWalletStorage() {
  if (!_publishInAppWalletStorage) {
    _publishInAppWalletStorage = {
      getItem: async (key) => {
        if (typeof window === 'undefined') return null
        return localStorage.getItem(SEED_IN_APP_SESSION_PREFIX + key)
      },
      setItem: async (key, value) => {
        if (typeof window === 'undefined') return
        localStorage.setItem(SEED_IN_APP_SESSION_PREFIX + key, value)
      },
      removeItem: async (key) => {
        if (typeof window === 'undefined') return
        localStorage.removeItem(SEED_IN_APP_SESSION_PREFIX + key)
      },
    }
  }
  return _publishInAppWalletStorage
}

/**
 * Copies Thirdweb in-app auth tokens between default localStorage keys and the
 * prefixed keys used by publish in-app wallets (`seedProtocol:inAppPublish:`).
 *
 * Modular ConnectButton writes the fresh session to prefixed storage; bare may be
 * stale. Prefer prefixed when both exist so managed-wallet autoConnect does not
 * overwrite a valid JWT with an old bare token.
 */
export function syncPublishInAppAuthToken(): {
  syncedBareToPrefixed: boolean
  syncedPrefixedToBare: boolean
} {
  if (typeof window === 'undefined') {
    return { syncedBareToPrefixed: false, syncedPrefixedToBare: false }
  }
  const { thirdwebClientId } = getPublishConfig()
  if (!thirdwebClientId) {
    return { syncedBareToPrefixed: false, syncedPrefixedToBare: false }
  }
  try {
    const bareKey = `walletToken-${thirdwebClientId}`
    const prefixedKey = `${SEED_IN_APP_SESSION_PREFIX}${bareKey}`
    const bare = localStorage.getItem(bareKey)
    const prefixed = localStorage.getItem(prefixedKey)

    let syncedBareToPrefixed = false
    let syncedPrefixedToBare = false

    // Only copy bare → prefixed when prefixed is missing (cold-start / refresh recovery).
    if (bare && !prefixed) {
      localStorage.setItem(prefixedKey, bare)
      syncedBareToPrefixed = true
    }
    if (prefixed && !bare) {
      localStorage.setItem(bareKey, prefixed)
      syncedPrefixedToBare = true
    }
    if (prefixed && bare && bare !== prefixed) {
      localStorage.setItem(bareKey, prefixed)
      syncedPrefixedToBare = true
    }

    return { syncedBareToPrefixed, syncedPrefixedToBare }
  } catch {
    return { syncedBareToPrefixed: false, syncedPrefixedToBare: false }
  }
}

async function connectManagedAccountWallet(chain: Chain = getPublishThirdwebChain()) {
  syncPublishInAppAuthToken()
  const managedAccountWallet = getManagedAccountWallet()
  await managedAccountWallet.autoConnect({ client: getClient(), chain })
  return managedAccountWallet
}

export { getClient } from './publishThirdwebClient'

export const wallets = [
  // embeddedWallet(),
  createWallet('io.metamask',),
  // createWallet("com.coinbase.wallet"),
  // createWallet("me.rainbow"),
]

export const useLocalWalletAccount = () => {

  const [ localWalletAccount, setLocalWalletAccount, ] = useState<Account | null>(null,)
  const personalWallet = createWallet('io.metamask',)

  const isConnecting = useRef(false)

  useEffect(() => {
    const _getAccount = async (): Promise<void> => {
      // if ( isConnecting.current ) {
      //   return
      // }
      // isConnecting.current = true

      // const personalAccount = await personalWallet.connect({ client, },)
      // if ( !personalAccount ) {
      //   throw new Error('Failed to connect to personal account',)
      // }

      // setLocalWalletAccount(personalAccount,)
      // isConnecting.current = false
    }

    _getAccount()

  }, [],)

  return localWalletAccount

}

export const useActiveSmartWalletContract = () => {
  const account = useActiveAccount()

  const [ contract, setContract, ] = useState<ThirdwebContract | null>(null,)

  useEffect(() => {
    if ( !account || !account.address ) {
      return
    }

    setContract(getContract({
      client: getClient(),
      chain   : getPublishThirdwebChain(),
      address : account.address,
    },),)

  }, [ account, ],)

  return contract
}

/**
 * Returns the deterministic smart wallet address for an admin signer and optional data.
 */
export async function getSmartWalletAddressForAdmin (
  adminAddress: string,
  data: string = '0x',
): Promise<string> {
  return readFactoryGetAddress(adminAddress as Address, data as Hex)
}

/**
 * Returns true if the given address has contract bytecode deployed (e.g. a ManagedAccount).
 */
export async function isSmartWalletDeployed ( smartWalletAddress: string, ): Promise<boolean> {
  return isContractDeployed(smartWalletAddress)
}

/** Polls chain bytecode until the smart account is deployed or attempts are exhausted. */
export async function pollSmartWalletDeployed(
  smartWalletAddress: string,
  attempts?: number,
  intervalMs?: number,
): Promise<boolean> {
  return pollDeployed(smartWalletAddress, attempts, intervalMs)
}

/**
 * Resolves the smart wallet address and account to use for publish.
 * If the user has no connected account or no deployed ManagedAccount, returns needsDeploy.
 *
 * When using EIP4337 (in-app wallet with account abstraction), account.address is already
 * the smart wallet address. We detect that case and use it directly instead of deriving
 * via getSmartWalletAddressForAdmin (which assumes account.address is the EOA admin).
 */
export async function resolveSmartWalletForPublish (
  account: Account | null,
): Promise<{ address: string; account: Account } | { needsDeploy: true }> {
  if ( !account ) {
    return { needsDeploy: true }
  }
  // If account.address is already a deployed smart wallet (e.g. from EIP4337), use it directly
  const accountIsDeployedSmartWallet = await isSmartWalletDeployed(account.address,)
  if ( accountIsDeployedSmartWallet ) {
    return { address: account.address, account }
  }
  // Otherwise derive smart wallet from EOA admin (e.g. MetaMask)
  const smartWalletAddress = await getSmartWalletAddressForAdmin(account.address,)
  const deployed = await isSmartWalletDeployed(smartWalletAddress,)
  if ( deployed ) {
    return { address: smartWalletAddress, account }
  }
  return { needsDeploy: true }
}

/** External wallets (MetaMask, Rainbow) for the deploy flow only; no account abstraction. */
export const ExternalWalletsForDeploy = [
  createWallet('io.metamask',),
  createWallet('me.rainbow',),
]

export const deploySmartWalletContract = async ( localAccount: Account, ) => {
  const accountContract = getContract({
    client: getClient(),
    chain   : getPublishThirdwebChain(),
    address : localAccount.address,
  },)
  const result = await deploySmartAccount({
    smartAccount    : localAccount,
    chain           : getPublishThirdwebChain(),
    client          : getClient(),
    accountContract,
  },)
  logger('deploySmartAccount result:', result,)
  return result
}

/**
 * Deploys a ManagedAccount by calling the Thirdweb factory `createAccount`.
 * Prefer the modular EIP-7702 in-app wallet as `signingAccount` (sponsorGas); it is more reliable
 * than `deploySmartAccount` on the counterfactual EIP-4337 managed wallet (UserOp factory deploy).
 */
export async function deployManagedAccountViaFactory(params: {
  adminAddress: string
  signingAccount: Account | PublishWallet
  data?: `0x${string}`
}): Promise<void> {
  const { asThirdwebPublishWallet } = await import('./adapters/thirdwebAccount')
  const wallet = asThirdwebPublishWallet(params.signingAccount as Account | PublishWallet)
  const tx = encodeCreateAccount(
    params.adminAddress as Address,
    (params.data ?? '0x') as Hex,
  )
  await wallet.txSender.sendTransaction(tx)
}

export const appMetadata = {
  name: "Seed Protocol",
  description: "Seed Protocol",
  url: "https://seedprotocol.io",
}

/**
 * Connects the managed account wallet (EIP4337 in-app wallet) and returns its address.
 * Use this when you need the connected managed account address for publish flows.
 *
 * @param chain - The chain to connect to (defaults to the publish chain)
 * @returns The connected managed account's address
 * @throws Error if the managed account cannot be connected or retrieved
 */
export async function getConnectedManagedAccountAddress(
  chain: Chain = getPublishThirdwebChain()
): Promise<string> {
  const managedAccountWallet = await connectManagedAccountWallet(chain)
  const managedAccount = managedAccountWallet.getAccount()
  if (!managedAccount) {
    throw new Error('Failed to get managed account')
  }
  return managedAccount.address
}

/**
 * Returns the connected account for transaction signing (e.g. revoke).
 * Uses the modular account wallet. Returns null if not connected.
 */
export async function getConnectedAccount(): Promise<Account | null> {
  try {
    const wallet = getModularAccountWallet()
    await wallet.autoConnect({ client: getClient(), chain: getPublishThirdwebChain() })
    const account = wallet.getAccount()
    return account ?? null
  } catch {
    return null
  }
}

/**
 * Same as {@link getConnectedAccount}: the in-app modular wallet (EIP-7702) on the publish chain.
 * Prefer this name at modular publish entry points for clarity.
 */
export async function getConnectedModularAccount(): Promise<Account | null> {
  return getConnectedAccount()
}

function managedAccountFactoryFor(config: PublishConfig): string {
  const chainId = getPublishThirdwebChain(config).id
  const factory = config.managedAccountFactoryAddress ?? MANAGED_ACCOUNT_FACTORY_ADDRESSES[chainId]
  if (!factory) {
    throw new Error(
      `@seedprotocol/publish: no ManagedAccount factory is known for chain ${chainId}. Pass managedAccountFactoryAddress in publish config, or use the EOA / direct EAS path.`,
    )
  }
  return factory
}

const IN_APP_AUTH_OPTIONS = ['farcaster', 'email', 'passkey', 'phone'] as const

/**
 * One instance per settings so Thirdweb session, Connect UI and `autoConnect` share a wallet
 * object. Rebuilt when the chain, RPC, factory or `PublishConfig.thirdweb` change
 * (e.g. `PublishProvider` applies config after first render).
 */
let _managedInAppWallet: { key: string; wallet: Wallet } | null = null

/**
 * Managed (EIP-4337) in-app wallet: the user's ManagedAccount smart account, admin = the
 * user's in-app EOA. Publishes are UserOps from this account.
 */
export const getManagedAccountWallet = (config?: PublishConfig) => {
  const cfg = config ?? getConfigRef()
  const chain = getPublishThirdwebChain(cfg ?? undefined)
  const factoryAddress = cfg ? managedAccountFactoryFor(cfg) : requireManagedAccountFactoryAddress()
  const { bundlerUrl, sponsorGas } = resolveThirdwebWalletOptions(cfg)
  if (!bundlerUrl && isLocalThirdwebChain(chain)) {
    throw new Error(
      `@seedprotocol/publish: chain ${chain.id} is local, so Thirdweb's hosted bundler cannot reach it. Set PublishConfig.thirdweb.bundlerUrl to the chain's bundler (seedTwinConfig does this for the twin).`,
    )
  }
  const key = [chain.id, chain.rpc, factoryAddress, bundlerUrl ?? '', sponsorGas].join('|').toLowerCase()
  if (_managedInAppWallet?.key !== key) {
    logGas('managed wallet built', {
      chainId: chain.id,
      sponsorGas,
      bundlerUrl: bundlerUrl ?? '(thirdweb default)',
      paymasterHook: sponsorGas ? 'installed' : 'none (thirdweb estimates callGasLimit itself)',
    })
    _managedInAppWallet = {
      key,
      wallet: inAppWallet({
        storage: getSharedPublishInAppWalletStorage(),
        auth: { options: [...IN_APP_AUTH_OPTIONS] },
        executionMode: {
          mode: 'EIP4337',
          smartAccount: {
            chain,
            factoryAddress,
            sponsorGas,
            ...(bundlerUrl || sponsorGas
              ? {
                  overrides: {
                    ...(bundlerUrl ? { bundlerUrl } : {}),
                    // Adds headroom to callGasLimit; see seedPaymaster.
                    ...(sponsorGas ? { paymaster: seedPaymaster(getClient, chain, bundlerUrl) } : {}),
                  },
                }
              : {}),
          },
        },
      }),
    }
  }
  return _managedInAppWallet.wallet
}

let _modularInAppWallet: { key: string; wallet: Wallet } | null = null

/**
 * The user's in-app EOA (same login and storage as {@link getManagedAccountWallet}), which is
 * the ManagedAccount's admin. Sends admin-only transactions such as `installSeedExecutor`.
 * `PublishConfig.thirdweb.modularWalletMode` picks EIP-7702 (default; gas-sponsored unless
 * `thirdweb.sponsorGas` is false) or a plain EOA.
 *
 * @throws for EIP-7702 on a local chain: Thirdweb runs 7702 through its hosted bundler, which
 * cannot reach it, sponsored or not.
 */
export const getModularAccountWallet = (config?: PublishConfig) => {
  const cfg = config ?? getConfigRef()
  const { modularWalletMode, sponsorGas } = resolveThirdwebWalletOptions(cfg)
  if (modularWalletMode === 'EIP7702') {
    const chain = getPublishThirdwebChain(cfg ?? undefined)
    if (isLocalThirdwebChain(chain)) {
      throw new Error(
        `@seedprotocol/publish: chain ${chain.id} is local, and Thirdweb's EIP-7702 mode needs its hosted bundler, which cannot reach it. Set PublishConfig.thirdweb.modularWalletMode to 'EOA' and fund the in-app EOA (seedTwinConfig does this for the twin).`,
      )
    }
  }
  const key = `${modularWalletMode}|${sponsorGas}`
  if (_modularInAppWallet?.key !== key) {
    _modularInAppWallet = {
      key,
      wallet: inAppWallet({
        storage: getSharedPublishInAppWalletStorage(),
        auth: { options: [...IN_APP_AUTH_OPTIONS] },
        executionMode:
          modularWalletMode === 'EOA' ? { mode: 'EOA' } : { mode: 'EIP7702', sponsorGas },
      }),
    }
  }
  return _modularInAppWallet.wallet
}

/** Wallets for `ConnectButton`; pass the context config so the first render uses it. */
export const getWalletsForConnectButton = (config?: PublishConfig) => {
  const cfg = config ?? getConfigRef() ?? undefined
  return cfg?.useModularExecutor ? [getModularAccountWallet(cfg)] : [getManagedAccountWallet(cfg)]
}
