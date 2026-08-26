import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BaseArweaveClient } from '../src/ArweaveClient/BaseArweaveClient.js'
import { resetArweaveReadGatewayForTests } from '../src/ArweaveClient/selectReadGateway.js'
import {
  DEFAULT_ARWEAVE_HOST,
  getArweaveReadGatewayHostsForPrimary,
  resolveArweaveHostFromEnv,
} from '../src/constants.js'

describe('resolveArweaveHostFromEnv', () => {
  const keys = ['NEXT_PUBLIC_ARWEAVE_HOST', 'ARWEAVE_HOST', 'VITE_ARWEAVE_HOST'] as const
  const original: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of keys) original[key] = process.env[key]
  })

  afterEach(() => {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key]
      else process.env[key] = original[key]
    }
    resetArweaveReadGatewayForTests()
  })

  it('reads VITE_ARWEAVE_HOST', () => {
    for (const key of keys) delete process.env[key]
    process.env.VITE_ARWEAVE_HOST = 'arweave.net'
    expect(resolveArweaveHostFromEnv()).toBe('arweave.net')
  })

  it('prefers NEXT_PUBLIC_ARWEAVE_HOST over ARWEAVE_HOST and VITE_ARWEAVE_HOST', () => {
    process.env.NEXT_PUBLIC_ARWEAVE_HOST = 'one.example'
    process.env.ARWEAVE_HOST = 'two.example'
    process.env.VITE_ARWEAVE_HOST = 'three.example'
    expect(resolveArweaveHostFromEnv()).toBe('one.example')
  })

  it('strips https:// scheme', () => {
    for (const key of keys) delete process.env[key]
    process.env.ARWEAVE_HOST = 'https://arweave.net'
    expect(resolveArweaveHostFromEnv()).toBe('arweave.net')
  })
})

describe('getArweaveReadGatewayHostsForPrimary', () => {
  it('includes seed gateway in fallbacks when primary is default', () => {
    const hosts = getArweaveReadGatewayHostsForPrimary(DEFAULT_ARWEAVE_HOST)
    expect(hosts[0]).toBe(DEFAULT_ARWEAVE_HOST)
    expect(hosts).toContain('arweave.net')
  })

  it('omits seed gateway from fallbacks when primary is custom', () => {
    const hosts = getArweaveReadGatewayHostsForPrimary('arweave.net')
    expect(hosts[0]).toBe('arweave.net')
    expect(hosts).not.toContain(DEFAULT_ARWEAVE_HOST)
    expect(hosts).toContain('g8way.io')
  })
})

describe('BaseArweaveClient env override', () => {
  afterEach(() => {
    resetArweaveReadGatewayForTests()
  })

  it('applies VITE_ARWEAVE_HOST in development', () => {
    process.env.NODE_ENV = 'development'
    process.env.VITE_ARWEAVE_HOST = 'arweave.net'
    resetArweaveReadGatewayForTests()
    expect(BaseArweaveClient.getHost()).toBe('arweave.net')
  })
})
