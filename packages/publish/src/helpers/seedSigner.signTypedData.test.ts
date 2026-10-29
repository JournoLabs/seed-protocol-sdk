import { describe, expect, test } from 'bun:test'
import { Wallet, type TypedDataField } from 'ethers'
import { recoverTypedDataAddress, type EIP1193Provider, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { optimismSepolia } from 'viem/chains'
import type { Account } from 'thirdweb/wallets'
import { fromEthersWallet, requireSignTypedData, type SeedSigner } from './seedSigner'
import { fromEip1193Provider } from './adapters/eip1193'
import { fromThirdwebAccount } from './adapters/thirdwebAccount'

// The ManagedAccount's session-key grant, the typed data these signers exist for.
const typedData = {
  domain: {
    name: 'Account',
    version: '1',
    chainId: optimismSepolia.id,
    verifyingContract: '0x1111111111111111111111111111111111111111',
  },
  types: {
    SignerPermissionRequest: [
      { name: 'signer', type: 'address' },
      { name: 'isAdmin', type: 'uint8' },
      { name: 'approvedTargets', type: 'address[]' },
      { name: 'nativeTokenLimitPerTransaction', type: 'uint256' },
      { name: 'permissionStartTimestamp', type: 'uint128' },
      { name: 'permissionEndTimestamp', type: 'uint128' },
      { name: 'reqValidityStartTimestamp', type: 'uint128' },
      { name: 'reqValidityEndTimestamp', type: 'uint128' },
      { name: 'uid', type: 'bytes32' },
    ],
  },
  primaryType: 'SignerPermissionRequest',
  message: {
    signer: '0x2222222222222222222222222222222222222222',
    isAdmin: 0,
    approvedTargets: ['0x3333333333333333333333333333333333333333'],
    nativeTokenLimitPerTransaction: 0n,
    permissionStartTimestamp: 0n,
    permissionEndTimestamp: 2n ** 64n,
    reqValidityStartTimestamp: 0n,
    reqValidityEndTimestamp: 2n ** 64n,
    uid: `0x${'ab'.repeat(32)}`,
  },
} as const

async function expectSignsAs(signer: SeedSigner, address: string) {
  const signature = await requireSignTypedData(signer)(typedData)
  expect(await recoverTypedDataAddress({ ...typedData, signature })).toBe(address as Hex)
}

/** An injected wallet that answers eth_signTypedData_v4 the way MetaMask does. */
function eip1193Wallet(wallet: Wallet): EIP1193Provider {
  return {
    request: async ({ method, params }: { method: string; params?: unknown[] }) => {
      if (method !== 'eth_signTypedData_v4') throw new Error(`unexpected ${method}`)
      const [from, json] = params as [string, string]
      if (from.toLowerCase() !== wallet.address.toLowerCase()) throw new Error(`wrong account ${from}`)
      const { domain, types, message } = JSON.parse(json) as {
        domain: Record<string, unknown>
        types: Record<string, TypedDataField[]>
        message: Record<string, unknown>
      }
      const { EIP712Domain: _domainType, ...rest } = types
      return wallet.signTypedData(domain, rest, message)
    },
  } as EIP1193Provider
}

describe('SeedSigner.signTypedData', () => {
  test('fromEthersWallet signs as the wallet', async () => {
    const wallet = Wallet.createRandom()
    await expectSignsAs(fromEthersWallet(wallet as unknown as Wallet).signer, wallet.address)
  })

  test('fromEip1193Provider signs through eth_signTypedData_v4', async () => {
    const wallet = Wallet.createRandom() as unknown as Wallet
    const { signer } = await fromEip1193Provider(eip1193Wallet(wallet), {
      chain: optimismSepolia,
      address: wallet.address as Hex,
    })
    await expectSignsAs(signer, wallet.address)
  })

  test('fromThirdwebAccount signs as the account', async () => {
    const local = privateKeyToAccount(Wallet.createRandom().privateKey as Hex)
    const account = {
      address: local.address,
      signMessage: local.signMessage,
      signTypedData: local.signTypedData,
    } as unknown as Account
    await expectSignsAs(fromThirdwebAccount(account).signer, local.address)
  })

  test('requireSignTypedData throws for a signer without it', () => {
    const signer: SeedSigner = {
      address: '0x1111111111111111111111111111111111111111',
      signMessage: async () => '0x',
    }
    expect(() => requireSignTypedData(signer)).toThrow(/has no signTypedData/)
  })
})
