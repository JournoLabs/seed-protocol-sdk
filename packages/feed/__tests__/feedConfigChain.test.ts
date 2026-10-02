import { afterEach, describe, expect, it } from 'vitest'
import { configureEasReadChain, resetEasReadChain } from '@seedprotocol/eas'
import { loadFeedConfig } from '../src/config'

const KEYS = ['FEED_ITEM_URL_BASE', 'EAS_CHAIN_ID', 'NEXT_PUBLIC_EAS_CHAIN_ID'] as const
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))

afterEach(() => {
  resetEasReadChain()
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('loadFeedConfig item link base', () => {
  it('defaults to the configured chain explorer', () => {
    for (const k of KEYS) delete process.env[k]
    expect(loadFeedConfig().itemUrlBase).toBe('https://optimism-sepolia.easscan.org')
    process.env.EAS_CHAIN_ID = '8453'
    expect(loadFeedConfig().itemUrlBase).toBe('https://base.easscan.org')
    configureEasReadChain('sdk', { chainId: 1 })
    expect(loadFeedConfig().itemUrlBase).toBe('https://easscan.org')
  })

  it('FEED_ITEM_URL_BASE wins', () => {
    process.env.EAS_CHAIN_ID = '8453'
    process.env.FEED_ITEM_URL_BASE = 'https://explorer.example'
    expect(loadFeedConfig().itemUrlBase).toBe('https://explorer.example')
  })
})
