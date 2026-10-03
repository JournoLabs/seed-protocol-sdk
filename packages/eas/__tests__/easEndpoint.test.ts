import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  configureEasReadChain,
  expectEasReadChain,
  getEasEndpoint,
  getEasReadChainId,
  isEasReadChainConfigured,
  isEasReadChainSettled,
  resetEasReadChain,
  whenEasReadChainSettled,
} from '../src/easEndpoint'

const ENV_KEYS = ['EAS_ENDPOINT', 'NEXT_PUBLIC_EAS_ENDPOINT', 'EAS_CHAIN_ID', 'NEXT_PUBLIC_EAS_CHAIN_ID'] as const
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

  it('throws when the env URL is another chain\'s known indexer', () => {
    clearEnv()
    process.env.NEXT_PUBLIC_EAS_ENDPOINT = 'https://optimism-sepolia.easscan.org/graphql/'
    configureEasReadChain('publish', { chainId: 31337 })
    expect(() => getEasEndpoint()).toThrow(/indexer for chain 11155420, but Seed reads EAS on chain 31337/)
    configureEasReadChain('sdk', { indexerUrl: 'http://localhost:4000/graphql' })
    expect(getEasEndpoint()).toBe('http://localhost:4000/graphql')
    resetEasReadChain()
    configureEasReadChain('publish', { chainId: 11155420 })
    expect(getEasEndpoint()).toBe('https://optimism-sepolia.easscan.org/graphql/')
  })

  it('requires an indexer for unknown chains', () => {
    clearEnv()
    configureEasReadChain('sdk', { chainId: 999_999 })
    expect(() => getEasEndpoint()).toThrow(/No EAS indexer is known for chain 999999/)
    configureEasReadChain('sdk', { chainId: 999_999, indexerUrl: 'https://custom.invalid/graphql' })
    expect(getEasEndpoint()).toBe('https://custom.invalid/graphql')
  })

  it('reads start on the local DB chain; configured chains must match it', () => {
    clearEnv()
    configureEasReadChain('localDb', { chainId: 8453 })
    expect(getEasReadChainId()).toBe(8453)
    expect(isEasReadChainConfigured()).toBe(false)
    expect(() => configureEasReadChain('publish', { chainId: 10 })).toThrow(
      /local database holds attestations from chain 8453, but the app is configured for chain 10/,
    )
    configureEasReadChain('sdk', { chainId: 8453 })
    expect(isEasReadChainConfigured()).toBe(true)
  })

  it('EAS_CHAIN_ID sets the chain below explicit config', () => {
    clearEnv()
    process.env.EAS_CHAIN_ID = '8453'
    expect(getEasReadChainId()).toBe(8453)
    expect(isEasReadChainConfigured()).toBe(true)
    expect(getEasEndpoint()).toBe('https://base.easscan.org/graphql')
    configureEasReadChain('publish', { chainId: 10 })
    expect(getEasReadChainId()).toBe(10)
  })

  it('is settled immediately when nothing announced a pending chain', async () => {
    clearEnv()
    expect(isEasReadChainSettled()).toBe(true)
    await expect(whenEasReadChainSettled(10)).resolves.toBe(true)
  })

  it('waits for an announced publish chain, then settles', async () => {
    clearEnv()
    expectEasReadChain('publish')
    expect(isEasReadChainSettled()).toBe(false)
    const waiting = whenEasReadChainSettled(5_000)
    configureEasReadChain('publish', { chainId: 8453 })
    await expect(waiting).resolves.toBe(true)
  })

  it('a recorded local DB chain or explicit SDK chain settles without publish', () => {
    clearEnv()
    expectEasReadChain('publish')
    configureEasReadChain('localDb', { chainId: 8453 })
    expect(isEasReadChainSettled()).toBe(true)
    resetEasReadChain()
    expectEasReadChain('publish')
    configureEasReadChain('sdk', { chainId: 8453 })
    expect(isEasReadChainSettled()).toBe(true)
  })

  it('times out to false when the announced source never configures', async () => {
    clearEnv()
    expectEasReadChain('publish')
    await expect(whenEasReadChainSettled(20)).resolves.toBe(false)
  })
})
