import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  configureEasReadChain,
  getEasEndpoint,
  getEasReadChainId,
  resetEasReadChain,
} from '../src/easEndpoint'

const ENV_KEYS = ['EAS_ENDPOINT', 'NEXT_PUBLIC_EAS_ENDPOINT'] as const
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k]
}

afterEach(() => {
  resetEasReadChain()
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  vi.restoreAllMocks()
})

describe('EAS read chain', () => {
  it('defaults to the Optimism Sepolia indexer', () => {
    clearEnv()
    expect(getEasReadChainId()).toBe(11155420)
    expect(getEasEndpoint()).toBe('https://optimism-sepolia.easscan.org/graphql')
  })

  it('follows the publish chain when the SDK does not set one', () => {
    clearEnv()
    configureEasReadChain('publish', { chainId: 8453 })
    expect(getEasReadChainId()).toBe(8453)
    expect(getEasEndpoint()).toBe('https://base.easscan.org/graphql')
  })

  it('throws when SDK and publish name different chains, in either order', () => {
    configureEasReadChain('sdk', { chainId: 8453 })
    expect(() => configureEasReadChain('publish', { chainId: 10 })).toThrow(/chain 8453.*chain 10/)
    resetEasReadChain()
    configureEasReadChain('publish', { chainId: 10 })
    expect(() => configureEasReadChain('sdk', { chainId: 8453 })).toThrow(/chain mismatch/)
    expect(getEasReadChainId()).toBe(10)
  })

  it('SDK indexerUrl beats env, env beats the chain default', () => {
    process.env.EAS_ENDPOINT = 'https://env.invalid/graphql'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    configureEasReadChain('publish', { chainId: 8453 })
    expect(getEasEndpoint()).toBe('https://env.invalid/graphql')
    expect(warn).toHaveBeenCalledOnce()
    configureEasReadChain('sdk', { indexerUrl: 'https://sdk.invalid/graphql' })
    expect(getEasEndpoint()).toBe('https://sdk.invalid/graphql')
  })

  it('requires an indexer for unknown chains', () => {
    clearEnv()
    configureEasReadChain('sdk', { chainId: 999_999 })
    expect(() => getEasEndpoint()).toThrow(/No EAS indexer is known for chain 999999/)
    configureEasReadChain('sdk', { chainId: 999_999, indexerUrl: 'https://custom.invalid/graphql' })
    expect(getEasEndpoint()).toBe('https://custom.invalid/graphql')
  })
})
