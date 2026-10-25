import { afterEach, describe, expect, it } from 'vitest'
import { BaseArweaveClient } from '../../src/ArweaveClient/BaseArweaveClient.js'
import { setResolvedSeedGatewayEndpoints } from '../../src/gateway/gatewayState.js'
import { getPublicArweaveBaseUrl, getPublicArweaveRawUrl } from '../../src/gateway/publicUrl.js'
import { resolveSeedGatewayEndpoints } from '../../src/gateway/resolveSeedGatewayEndpoints.js'

const TX = 'a'.repeat(43)

describe('getPublicArweaveBaseUrl', () => {
  const originalBaseUrl = BaseArweaveClient.getBaseUrl()
  afterEach(() => {
    setResolvedSeedGatewayEndpoints(null)
    BaseArweaveClient.setHost(originalBaseUrl)
  })

  it('never writes the read host before endpoints resolve, even when it is a local sidecar', () => {
    BaseArweaveClient.setHost('http://127.0.0.1:1984')
    expect(getPublicArweaveRawUrl(TX)).toBe(`https://arweave.net/raw/${TX}`)
  })

  it('uses a public read host set before endpoints resolve (a query or feed server)', () => {
    BaseArweaveClient.setHost('gateway.example')
    expect(getPublicArweaveBaseUrl()).toBe('https://gateway.example')
  })

  it('treats an empty arweaveDomain as the default host', async () => {
    setResolvedSeedGatewayEndpoints(await resolveSeedGatewayEndpoints({ transport: 'http-gateway', arweaveDomain: '' }))
    expect(getPublicArweaveRawUrl(TX)).toBe(`https://arweave.net/raw/${TX}`)
  })
})
