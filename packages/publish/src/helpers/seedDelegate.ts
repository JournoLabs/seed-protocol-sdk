import type { Address, Hex } from 'viem'
import { getPublishConfig } from '../config'
import { ManagedAccountPublishError } from '../errors'
import { accountCodeKind, delegationTarget, getPublishPublicClient } from './chainClient'
import { SIMPLE_7702_ACCOUNT_ADDRESS } from './constants'
import { readGetEas } from './contracts'
import type { SeedTxSender } from './seedSigner'

/**
 * Whether `address` publishes with `multiPublish` through the Seed delegate (ADR 0040):
 * `'delegated'` when its code delegates there; `'will_delegate'` when `accountMode` is `eip7702`,
 * its sender delegates to the configured delegate, and it has no code or is on
 * `Simple7702Account`; otherwise `false`. A sender that doesn't delegate (a plain EOA sender)
 * would send `multiPublish` to an address with no code, which does nothing, so it stays on direct
 * EAS. Without a configured delegate this reads nothing.
 */
export async function sendsThroughSeedDelegate(
  address: string,
  sender: Pick<SeedTxSender, 'delegatesTo'> | undefined,
): Promise<'delegated' | 'will_delegate' | false> {
  const { seedDelegateAddress, accountMode } = getPublishConfig()
  if (!seedDelegateAddress) return false
  const delegate = seedDelegateAddress.toLowerCase()
  const code = await getPublishPublicClient().getCode({ address: address as Address })
  const current = delegationTarget(code)
  if (current === delegate) return 'delegated'
  if (accountMode !== 'eip7702' || sender?.delegatesTo?.toLowerCase() !== delegate) return false
  if (accountCodeKind(code) === 'none' || current === SIMPLE_7702_ACCOUNT_ADDRESS.toLowerCase()) return 'will_delegate'
  return false
}

/** The code to simulate and estimate a send with: the delegate's runtime code before the EOA delegates to it. */
export async function seedDelegateCodeOverride(
  route: 'delegated' | 'will_delegate',
  delegate: Address,
): Promise<Hex | undefined> {
  if (route === 'delegated') return undefined
  const code = await getPublishPublicClient().getCode({ address: delegate })
  return code && code !== '0x' ? code : undefined
}

const easChecked = new Set<string>()

/** @internal For tests. */
export function resetSeedDelegateEasCache(): void {
  easChecked.clear()
}

/**
 * Throws `PUBLISH_PREFLIGHT_FAILED` unless the delegate's `getEas()` is the configured EAS: its EAS
 * is fixed in its code, and attestations sent through it go there. A match is remembered per
 * delegate and EAS.
 */
export async function assertSeedDelegateEas(delegate: Address): Promise<void> {
  const { easContractAddress } = getPublishConfig()
  const key = `${delegate.toLowerCase()}:${easContractAddress.toLowerCase()}`
  if (easChecked.has(key)) return
  let eas: string
  try {
    eas = await readGetEas(delegate)
  } catch (cause) {
    throw new ManagedAccountPublishError(
      `Couldn't read the EAS contract of the Seed delegate ${delegate}; nothing was sent. Check seedDelegateAddress and the RPC connection.`,
      'PUBLISH_PREFLIGHT_FAILED',
      delegate,
      cause,
    )
  }
  if (eas.toLowerCase() !== easContractAddress.toLowerCase()) {
    throw new ManagedAccountPublishError(
      `The Seed delegate ${delegate} attests to EAS ${eas}, but publish config sets easContractAddress to ${easContractAddress}; nothing was sent.`,
      'PUBLISH_PREFLIGHT_FAILED',
      delegate,
    )
  }
  easChecked.add(key)
}
