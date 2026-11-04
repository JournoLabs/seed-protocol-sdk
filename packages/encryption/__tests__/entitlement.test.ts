import { afterEach, describe, expect, it } from 'vitest'
import { UnknownEntitlementKindError, isEntitled, registerEntitlementAdapter, type EntitlementBlockTag } from '../src/index'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

describe('entitlement adapters', () => {
  it('asks the adapter registered for the policy kind, with the pinned block', async () => {
    const seen: [string, EntitlementBlockTag][] = []
    cleanups.push(
      registerEntitlementAdapter('allowlist', {
        isEntitled: async (policy, address, blockTag) => {
          seen.push([address, blockTag])
          return (policy.gateConfig as string[]).includes(address)
        },
      }),
    )
    const policy = { policyId: '0x01', kind: 'allowlist', gateConfig: ['0xaa'] }
    expect(await isEntitled(policy, '0xaa', 123n)).toBe(true)
    expect(await isEntitled(policy, '0xbb')).toBe(false)
    expect(seen).toEqual([['0xaa', 123n], ['0xbb', 'latest']])
  })

  it('rejects a policy kind with no adapter', async () => {
    await expect(isEntitled({ policyId: '0x01', kind: 'nobody' }, '0xaa')).rejects.toBeInstanceOf(UnknownEntitlementKindError)
  })

  it('refuses a second adapter for the same kind until the first is removed', async () => {
    const remove = registerEntitlementAdapter('dup', { isEntitled: async () => true })
    expect(() => registerEntitlementAdapter('dup', { isEntitled: async () => false })).toThrow(/already registered/)
    remove()
    cleanups.push(registerEntitlementAdapter('dup', { isEntitled: async () => false }))
    expect(await isEntitled({ policyId: '0x01', kind: 'dup' }, '0xaa')).toBe(false)
  })
})
