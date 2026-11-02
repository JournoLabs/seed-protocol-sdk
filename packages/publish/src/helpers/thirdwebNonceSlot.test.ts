import { describe, expect, test } from 'bun:test'
import { pinnedNonce } from './pinnedNonce'
import { seedAccountNonce, takeNonceSlot, withNonceSlot } from './thirdwebNonceSlot'

const ACCOUNT = '0xAaAa000000000000000000000000000000000000'

const never = () => new Promise<never>(() => {})
const tick = () => new Promise((resolve) => setTimeout(resolve, 1))

describe('thirdweb nonce slot', () => {
  test('the hook takes a send’s key once, whatever case the address is in', async () => {
    await withNonceSlot(ACCOUNT, 3n, async () => {
      expect(takeNonceSlot(ACCOUNT.toLowerCase())).toBe(3n)
      expect(takeNonceSlot(ACCOUNT)).toBeUndefined()
    })
  })

  test('a second send can’t take the first one’s key', async () => {
    const seen: Array<bigint | undefined> = []
    await Promise.all([
      withNonceSlot(ACCOUNT, 1n, async () => {
        await tick()
        seen.push(takeNonceSlot(ACCOUNT))
      }),
      withNonceSlot(ACCOUNT, undefined, async () => {
        seen.push(takeNonceSlot(ACCOUNT))
      }),
    ])
    expect(seen).toEqual([1n, undefined])
  })

  test('the next send goes as soon as the key is taken, not when the first one lands', async () => {
    let second = false
    void withNonceSlot(ACCOUNT, 1n, async () => {
      takeNonceSlot(ACCOUNT)
      await never()
    })
    await withNonceSlot(ACCOUNT, 2n, async () => {
      second = true
      expect(takeNonceSlot(ACCOUNT)).toBe(2n)
    })
    expect(second).toBe(true)
  })

  test('a send that fails before the hook frees the slot', async () => {
    const other = '0xbb00000000000000000000000000000000000000'
    await expect(
      withNonceSlot(other, 1n, async () => {
        throw new Error('failed')
      }),
    ).rejects.toThrow('failed')
    expect(takeNonceSlot(other)).toBeUndefined()
    expect(await withNonceSlot(other, 2n, async () => takeNonceSlot(other))).toBe(2n)
  })

  test('accounts don’t wait for each other', async () => {
    void withNonceSlot('0xcc00000000000000000000000000000000000000', 1n, never)
    expect(await withNonceSlot('0xdd00000000000000000000000000000000000000', 2n, async () => 'sent')).toBe('sent')
  })
})

describe('seedAccountNonce', () => {
  test('gives the asking send its key at sequence 0, once', async () => {
    await withNonceSlot(ACCOUNT, 5n, async () => {
      expect(await seedAccountNonce({ address: ACCOUNT })).toBe(pinnedNonce(5n))
      expect(await seedAccountNonce({ address: ACCOUNT })).not.toBe(pinnedNonce(5n))
    })
  })

  test('with no send asking, a random key at sequence 0', async () => {
    const a = await seedAccountNonce({ address: ACCOUNT })
    const b = await seedAccountNonce({ address: ACCOUNT })
    expect(a).not.toBe(b)
    expect(a & ((1n << 64n) - 1n)).toBe(0n)
    expect(a >> 256n).toBe(0n)
  })
})
