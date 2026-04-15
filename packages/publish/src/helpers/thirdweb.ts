import { createThirdwebClient, getContract, sendTransaction, waitForReceipt, } from 'thirdweb'
import { createWallet, Account, inAppWallet, type Wallet, } from 'thirdweb/wallets'
import { useActiveAccount } from 'thirdweb/react'
import { ThirdwebContract, } from 'thirdweb/contract'
import { isContractDeployed } from 'thirdweb/utils'
import { useEffect, useRef, useState, } from 'react'
import type { Chain } from 'thirdweb/chains'
import { optimismSepolia, } from 'thirdweb/chains'
import {
  createAccount,
  getAddress as getFactoryAddress,
} from './thirdweb/11155420/0x76f47d88bfaf670f5208911181fcdc0e160cb16d'
import debug from 'debug'
import { getPublishConfig } from '../config'
import { THIRDWEB_ACCOUNT_FACTORY_ADDRESS } from './constants'

const logger = debug('permaPress:helpers:thirdweb')

/**
 * Thirdweb `ClientScopedStorage` defaults to `localStorage`, which can retain embedded-wallet
 * material across disconnect when combined with the shared in-app connector (NDJSON showed
 * `localStorageRelevantKeys: []` after disconnect yet the next connect still resolved a prior user).
 * Both managed + modular in-app wallets share this adapter so EIP-4337 and EIP-7702 see one auth space.
 */
const SEED_IN_APP_SESSION_PREFIX = 'seedProtocol:inAppPublish:'

// #region agent log
function agentLogThirdwebDebug(
  location: string,
  message: string,
  data: Record<string, unknown>,
): void {
  fetch('http://127.0.0.1:7754/ingest/2810478a-7cf0-49a8-bc23-760b81417972', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'af71b7' },
    body: JSON.stringify({
      sessionId: 'af71b7',
      location,
      message,
      data: { ...data, timestamp: Date.now() },
    }),
  }).catch(() => {})
}

/** Debug: snapshot session vs local persistence (no secret values). */
export function debugLogWalletPersistenceSnapshot(
  location: string,
  hypothesisId: string,
  label: string,
): void {
  if (typeof window === 'undefined') return
  const seedSessionKeySuffixes: string[] = []
  for (let i = 0; i < sessionStorage.length; i++) {
    const k = sessionStorage.key(i)
    if (k?.startsWith(SEED_IN_APP_SESSION_PREFIX)) {
      seedSessionKeySuffixes.push(k.slice(SEED_IN_APP_SESSION_PREFIX.length))
    }
  }
  const thirdwebLocalKeySamples: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (!k) continue
    if (
      k.startsWith('thirdweb') ||
      k.startsWith('tw:') ||
      k.startsWith('thirdwebEws') ||
      k.startsWith('walletToken-')
    ) {
      thirdwebLocalKeySamples.push(k.length > 48 ? `${k.slice(0, 45)}…` : k)
    }
  }
  agentLogThirdwebDebug(location, label, {
    hypothesisId,
    seedSessionKeyCount: seedSessionKeySuffixes.length,
    seedSessionKeySuffixSamples: seedSessionKeySuffixes.slice(0, 6),
    thirdwebLocalKeyCount: thirdwebLocalKeySamples.length,
    thirdwebLocalKeySamples: thirdwebLocalKeySamples.slice(0, 10),
  })
}
// #endregion

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
        return sessionStorage.getItem(SEED_IN_APP_SESSION_PREFIX + key)
      },
      setItem: async (key, value) => {
        if (typeof window === 'undefined') return
        sessionStorage.setItem(SEED_IN_APP_SESSION_PREFIX + key, value)
      },
      removeItem: async (key) => {
        if (typeof window === 'undefined') return
        sessionStorage.removeItem(SEED_IN_APP_SESSION_PREFIX + key)
      },
    }
  }
  return _publishInAppWalletStorage
}

function clearSeedInAppSessionStorageKeys(): void {
  if (typeof window === 'undefined') return
  const rm: string[] = []
  for (let i = 0; i < sessionStorage.length; i++) {
    const k = sessionStorage.key(i)
    if (k?.startsWith(SEED_IN_APP_SESSION_PREFIX)) rm.push(k)
  }
  for (const k of rm) {
    try {
      sessionStorage.removeItem(k)
    } catch {
      /* ignore */
    }
  }
}

let _client: ReturnType<typeof createThirdwebClient> | null = null

export function getClient() {
  if (!_client) {
    const { thirdwebClientId } = getPublishConfig()
    _client = createThirdwebClient({ clientId: thirdwebClientId })
  }
  return _client
}

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
      chain   : optimismSepolia,
      address : account.address,
    },),)

  }, [ account, ],)

  return contract
}

export const getManagedAccountFactoryContract = () => {
  const { thirdwebAccountFactoryAddress } = getPublishConfig()
  const contract = getContract({
    client: getClient(),
    chain   : optimismSepolia,
    address : thirdwebAccountFactoryAddress,
  },)

  return contract
}

/**
 * Returns the deterministic smart wallet address for an admin signer and optional data.
 */
export async function getSmartWalletAddressForAdmin (
  adminAddress: string,
  data: string = '0x',
): Promise<string> {
  const factory = getManagedAccountFactoryContract()
  return getFactoryAddress({
    contract    : factory,
    adminSigner : adminAddress,
    data        : data as `0x${string}`,
  },) as Promise<string>
}

/**
 * Returns true if the given address has contract bytecode deployed (e.g. a ManagedAccount).
 */
export async function isSmartWalletDeployed ( smartWalletAddress: string, ): Promise<boolean> {
  const contract = getContract({
    client: getClient(),
    chain   : optimismSepolia,
    address : smartWalletAddress,
  },)
  return isContractDeployed(contract,)
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
  const managedAccountFactoryContract = getManagedAccountFactoryContract()
  const createAccountTx = createAccount({
    contract : managedAccountFactoryContract,
    admin    : localAccount.address,
    data     : '0x',
  },)

  const result = await sendTransaction({
    account     : localAccount,
    transaction : createAccountTx,
  },)

  logger('createAccountTx result:', result,)

  const receipt = await waitForReceipt({
    client: getClient(),
    transactionHash : result.transactionHash,
    chain           : optimismSepolia,
  },)

  if ( !receipt ) {
    throw new Error('Failed to deploy smart wallet',)
  }

  return receipt
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
 * @param chain - The chain to connect to (defaults to optimismSepolia)
 * @returns The connected managed account's address
 * @throws Error if the managed account cannot be connected or retrieved
 */
export async function getConnectedManagedAccountAddress(
  chain: Chain = optimismSepolia
): Promise<string> {
  const managedAccountWallet = getManagedAccountWallet()
  await managedAccountWallet.autoConnect({ client: getClient(), chain })
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
    await wallet.autoConnect({ client: getClient(), chain: optimismSepolia })
    const account = wallet.getAccount()
    return account ?? null
  } catch {
    return null
  }
}

/**
 * Same as {@link getConnectedAccount}: the in-app modular wallet (EIP-7702) on Optimism Sepolia.
 * Prefer this name at modular publish entry points for clarity.
 */
export async function getConnectedModularAccount(): Promise<Account | null> {
  return getConnectedAccount()
}

/** Single instance so Thirdweb session, Connect UI, and `autoConnect` share one wallet object. */
let _managedInAppWallet: Wallet | null = null

export const getManagedAccountWallet = () => {
  if (!_managedInAppWallet) {
    _managedInAppWallet = inAppWallet({
    storage: getSharedPublishInAppWalletStorage(),
    auth: {
      options: [
        "farcaster",
        "email",
        "passkey",
        "phone",
      ],
    },
    executionMode: {
      mode: 'EIP4337',
      smartAccount: {
        chain: optimismSepolia,
        factoryAddress: THIRDWEB_ACCOUNT_FACTORY_ADDRESS,
        gasless: true,
      },
    },
     // executionMode: {
      //   mode: 'EIP4337',
      //   smartAccount: {
      //     chain: optimismSepolia,
      //     factoryAddress: thirdwebAccountFactoryAddress,
      //     gasless: true,
      //     overrides: {
      //       // Custom paymaster that passes through but lets you modify the UserOp
      //       paymaster: async (userOp) => {

      //         const hexifyBigInts: any = (obj: any) => {
      //           if (typeof obj === "bigint") return `0x${obj.toString(16)}`;
      //           if (Array.isArray(obj)) return obj.map(hexifyBigInts);
      //           if (obj && typeof obj === "object") {
      //             return Object.fromEntries(
      //               Object.entries(obj).map(([k, v]) => [k, hexifyBigInts(v)])
      //             );
      //           }
      //           return obj;
      //         };

      //         const chainIdHex = `0x${optimismSepolia.id.toString(16)}`;

      //         // Increase callGasLimit before sending to paymaster
      //         const modifiedUserOp = hexifyBigInts({
      //           ...userOp,
      //           callGasLimit: BigInt(8000000), // Double it, or set a fixed value
      //         });

      //         console.log("[SmartWallet Paymaster]", getPublishConfig().thirdwebClientId);
              
      //         // Call thirdweb's default paymaster endpoint
      //         const response = await fetch(
      //           `https://${optimismSepolia.id}.bundler.thirdweb.com/v2`,
      //           {
      //             method: "POST",
      //             headers: { 
      //               "Content-Type": "application/json",
      //               "X-Client-Id": getPublishConfig().thirdwebClientId,
      //             },
      //             body: JSON.stringify({
      //               id: 1,
      //               jsonrpc: "2.0",
      //               method: "pm_sponsorUserOperation",
      //               params: [modifiedUserOp, '0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789', chainIdHex],
      //             }),
      //           }
      //         );
              
      //         const data = await response.json();
      //         console.log("[SmartWallet Paymaster Response]", data);
      //         return {
      //           paymasterAndData: data.result.paymasterAndData,
      //           preVerificationGas: data.result.preVerificationGas,
      //           verificationGasLimit: data.result.verificationGasLimit,
      //           callGasLimit: data.result.callGasLimit,
      //         };
      //       },
      //       execute: (accountContract, transaction) => {
      //         // Log the gas that was set on the transaction
      //         console.log("[SmartWallet Execute]", {
      //           gas: transaction.gas,
      //           to: transaction.to,
      //           dataLength: transaction.data?.length,
      //         });
        
      //         // Return the default execute call — don't change behavior,
      //         // just observe what's being passed through
      //         return prepareContractCall({
      //           contract: accountContract,
      //           method: "function execute(address, uint256, bytes)",
      //           params: [
      //             transaction.to ?? "",
      //             transaction.value ?? 0n,
      //             transaction.data ?? "0x",
      //           ],
      //           gas: transaction.gas, // Pass through whatever was set
      //         });
      //       },
      //     },
      //   }
      // }
    })
  }
  return _managedInAppWallet
}

/** Single instance (pairs with {@link getManagedAccountWallet} for two execution modes, same Thirdweb client). */
let _modularInAppWallet: Wallet | null = null

export const getModularAccountWallet = () => {
  if (!_modularInAppWallet) {
    _modularInAppWallet = inAppWallet({
    storage: getSharedPublishInAppWalletStorage(),
    auth: {
      options: [
        "farcaster",
        "email",
        "passkey",
        "phone",
      ],
    },
    executionMode: {
      mode: 'EIP7702',
      sponsorGas: true,
      
    },
    })
  }
  return _modularInAppWallet
}

let _walletsForConnectButton: Wallet[] | null = null

export const getWalletsForConnectButton = () => {
  if (!_walletsForConnectButton) {
    _walletsForConnectButton = [getModularAccountWallet()]
  }
  return _walletsForConnectButton
}

/**
 * Removes Thirdweb Connect UI keys that often survive `wallet.disconnect()` (runtime logs showed
 * `thirdweb:last-used-wallet-id` + `thirdweb:connected-wallet-ids` left behind), which can steer the
 * next connect / autoConnect toward a previous in-app profile.
 *
 * Also removes in-app embedded wallet keys from `client-scoped-storage.js` / `settings.js` that
 * `iframe-auth.logout()` does **not** clear (e.g. device-share `a-{clientKey}-*`, `thirdwebEwsWalletUserId-*`).
 * Post-clear localStorage was empty in NDJSON line 11 but the next connect still resolved to a prior user
 * (lines 13–16), so residual EWS keys are the next target.
 *
 * Connect manager keys mirror `node_modules/thirdweb/dist/esm/wallets/manager/index.js` and `walletStorage.js`.
 */
function clearThirdwebConnectBrowserPersistence(): void {
  if (typeof window === 'undefined') return
  // #region agent log
  debugLogWalletPersistenceSnapshot(
    'thirdweb.ts:clearThirdwebConnectBrowserPersistence:pre',
    'H3',
    'before clearThirdwebConnectBrowserPersistence',
  )
  // #endregion
  const keys = [
    'thirdweb:last-used-wallet-id',
    'thirdweb:connected-wallet-ids',
    'thirdweb:active-wallet-id',
    'thirdweb:active-chain',
    'tw:connected-wallet-params',
  ]
  for (const k of keys) {
    try {
      localStorage.removeItem(k)
    } catch {
      /* ignore */
    }
  }
  let clientId = ''
  try {
    clientId = getClient().clientId
  } catch {
    /* publish not configured yet */
  }
  const embeddedPrefixes = [
    'thirdwebEws',
    'walletToken-',
    'passkey-credential-id-',
    'thirdweb_guest_session_id_',
    'walletConnectSessions-',
  ]
  try {
    const toRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k) continue
      for (const p of embeddedPrefixes) {
        if (k.startsWith(p)) {
          toRemove.push(k)
          break
        }
      }
      if (clientId && k.startsWith(`a-${clientId}`)) {
        toRemove.push(k)
      }
    }
    for (const k of [...new Set(toRemove)]) {
      localStorage.removeItem(k)
    }
  } catch {
    /* ignore */
  }
  clearSeedInAppSessionStorageKeys()
}

/**
 * Disconnects both in-app execution modes (EIP-7702 modular + EIP-4337 managed).
 * Call after the Connect UI disconnects so managed sessions do not keep autoConnecting the previous user.
 */
export async function disconnectAllInAppPublishWallets(): Promise<void> {
  // #region agent log
  agentLogThirdwebDebug('thirdweb.ts:disconnectAllInAppPublishWallets', 'disconnectAllInAppPublishWallets entry', {
    hypothesisId: 'H2',
    stack: new Error().stack?.split('\n').slice(0, 8).join(' | '),
  })
  // #endregion
  await getModularAccountWallet().disconnect().catch(() => {})
  await getManagedAccountWallet().disconnect().catch(() => {})
  clearThirdwebConnectBrowserPersistence()
}