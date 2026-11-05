import { bytesToHex } from 'viem'
import { pinnedNonce } from './pinnedNonce'

/**
 * Thirdweb asks for a UserOp's nonce through a hook set once on the wallet, with no way to tell
 * which send is asking. So a send puts its nonce key here, and sends from one account wait their
 * turn only until the hook has taken it, not until they land.
 */
type Slot = { key: bigint | undefined; release: () => void }

const slots = new Map<string, Slot>()
const tails = new Map<string, Promise<void>>()

/**
 * Runs `send` with `key` offered to the account's nonce hook. `onKeyUnused` runs when `send`
 * settles, sent or not, if a key was offered and the hook never took it: the wallet asked for no
 * nonce through `seedAccountNonce`, so whatever it sent went under a key of its own.
 */
export async function withNonceSlot<T>(
  account: string,
  key: bigint | undefined,
  send: () => Promise<T>,
  onKeyUnused?: () => void,
): Promise<T> {
  const id = account.toLowerCase()
  const previous = tails.get(id) ?? Promise.resolve()
  let release!: () => void
  tails.set(id, new Promise<void>((resolve) => (release = resolve)))
  await previous
  const slot: Slot = { key, release }
  slots.set(id, slot)
  try {
    return await send()
  } finally {
    if (slots.get(id) === slot) {
      slots.delete(id)
      if (key !== undefined) onKeyUnused?.()
    }
    release()
  }
}

/** The key of the send now asking for a nonce, once. */
export function takeNonceSlot(account: string): bigint | undefined {
  const id = account.toLowerCase()
  const slot = slots.get(id)
  slots.delete(id)
  slot?.release()
  return slot?.key
}

const randomNonceKey = (): bigint => BigInt(bytesToHex(crypto.getRandomValues(new Uint8Array(24))))

/**
 * `getAccountNonce` for a thirdweb smart wallet's `overrides`: the nonce key of the send now asking,
 * else a random key as thirdweb's own default, whose sequence is 0. A wallet built with it can be
 * wrapped with `fromThirdwebAccount(account, { pinsNonce: true })`.
 */
export async function seedAccountNonce(accountContract: { address: string }): Promise<bigint> {
  return pinnedNonce(takeNonceSlot(accountContract.address) ?? randomNonceKey())
}
