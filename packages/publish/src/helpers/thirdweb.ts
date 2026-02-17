import { createThirdwebClient, getContract, sendTransaction, waitForReceipt, } from 'thirdweb'
import { createWallet, Account, inAppWallet, type Wallet, } from 'thirdweb/wallets'
import { useActiveAccount } from 'thirdweb/react'
import { ThirdwebContract, } from 'thirdweb/contract'
import { isContractDeployed } from 'thirdweb/utils'
import { useEffect, useRef, useState, } from 'react'
import { optimismSepolia, } from 'thirdweb/chains'
import {
  createAccount,
  getAddress as getFactoryAddress,
} from './thirdweb/11155420/0x76f47d88bfaf670f5208911181fcdc0e160cb16d'
import debug from 'debug'
import type { TransactionReceipt } from 'thirdweb/transaction'
import { getPublishConfig } from '../config'

const logger = debug('permaPress:helpers:thirdweb')

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
      client : getClient(),
      chain   : optimismSepolia,
      address : account.address,
    },),)

  }, [ account, ],)

  return contract
}

export const getManagedAccountFactoryContract = () => {
  const { thirdwebAccountFactoryAddress } = getPublishConfig()
  const contract = getContract({
    client : getClient(),
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
    client : getClient(),
    chain   : optimismSepolia,
    address : smartWalletAddress,
  },)
  return isContractDeployed(contract,)
}

/**
 * Resolves the smart wallet address and account to use for publish.
 * If the user has no connected account or no deployed ManagedAccount, returns needsDeploy.
 */
export async function resolveSmartWalletForPublish (
  account: Account | null,
): Promise<{ address: string; account: Account } | { needsDeploy: true }> {
  if ( !account ) {
    return { needsDeploy: true }
  }
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

export const deploySmartWalletContract = async (
  localAccount: Account,
): Promise<TransactionReceipt> => {
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
    client : getClient(),
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

export function getWalletsForConnectButton(): Wallet[] {
  const { thirdwebAccountFactoryAddress } = getPublishConfig()
  return [
    inAppWallet({
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
          factoryAddress: thirdwebAccountFactoryAddress,
          gasless: true,
        }
      }
    }),
  ]
}