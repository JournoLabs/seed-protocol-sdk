/**
 * Smoke test of BaseArweaveClient against public gateways: arweave.net, zigza.xyz and
 * vilenarios.com. Skipped unless SEED_LIVE_NETWORK_TESTS=1, and Node only. The client's behaviour
 * is covered without the network by ArweaveClient.arlocal.test.ts (a local node) and
 * ArweaveClient.test.ts (a mocked client); this file checks that real gateways still serve what
 * the client asks for.
 *
 * The client runs against the first gateway that answers `/info`; status checks fall back across
 * all three. A test fails only when none of them serves the known transaction.
 *
 *   SEED_LIVE_NETWORK_TESTS=1 bunx vitest run --project NodeJS packages/sdk/__tests__/helpers/ArweaveClient/ArweaveClient.live.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  BaseArweaveClient,
  invalidateReadGatewayCache,
  setPreferredArweaveReadBaseUrls,
} from '@seedprotocol/arweave'
import '@seedprotocol/arweave/node'
import { DEFAULT_ARWEAVE_HOST } from '@/helpers/constants'

/** Public gateways this test reads from, in order. */
export const LIVE_GATEWAYS = ['arweave.net', 'zigza.xyz', 'vilenarios.com'] as const

// ArDrive logo, a permanent mainnet transaction
// https://viewblock.io/arweave/tx/bNbA3TEQVL60xlgCcqdz4ZPHFZ711cZ3hmkpGttDt_U
const KNOWN_TX_ID = 'bNbA3TEQVL60xlgCcqdz4ZPHFZ711cZ3hmkpGttDt_U'
const MISSING_TX_ID = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

const PROBE_TIMEOUT_MS = 8000
const NETWORK_TIMEOUT = 45000

const runLive = typeof window === 'undefined' && process.env.SEED_LIVE_NETWORK_TESTS === '1'

type Probe = { host: string; info: number | string; knownTx: number | string }

const probe = async (url: string): Promise<number | string> => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    await response.body?.cancel().catch(() => {})
    return response.status
  } catch (error) {
    return error instanceof Error ? error.name : String(error)
  }
}

describe.skipIf(!runLive)('ArweaveClient against public gateways', () => {
  const probes: Probe[] = []
  let gateway: string | undefined
  const previousReadGateways = process.env.ARWEAVE_READ_GATEWAYS

  // With SEED_GATEWAY_HYPER_KEY set, status checks ask our Hyper gateway first.
  let hyperTunnel: { baseUrl: string; close: () => Promise<void> } | undefined

  beforeAll(async () => {
    for (const host of LIVE_GATEWAYS) {
      probes.push({
        host,
        info: await probe(`https://${host}/info`),
        knownTx: await probe(`https://${host}/raw/${KNOWN_TX_ID}`),
      })
    }
    console.info('[ArweaveClient live] gateway probes:', probes)
    gateway = probes.find((p) => p.info === 200 && p.knownTx === 200)?.host
    if (!gateway) return

    process.env.ARWEAVE_READ_GATEWAYS = LIVE_GATEWAYS.join(',')
    BaseArweaveClient.setHost(`https://${gateway}`)
    BaseArweaveClient.resetReadGatewaySelectionStateForTests()
    invalidateReadGatewayCache()

    const key = process.env.SEED_GATEWAY_HYPER_KEY?.trim()
    if (!key) return
    try {
      const { connectTunnel } = await import('@seedprotocol/gateway-hyper')
      hyperTunnel = await connectTunnel({ key, host: '127.0.0.1', port: 0, connectTimeoutMs: 20000 })
      // The tunnel dials the operator on its first request; only use it once that request works.
      const info = await fetch(`${hyperTunnel.baseUrl}/info`, { signal: AbortSignal.timeout(25000) })
      if (!info.ok) throw new Error(`GET /info through the tunnel returned ${info.status}`)
      setPreferredArweaveReadBaseUrls([hyperTunnel.baseUrl])
    } catch (error) {
      console.warn('[ArweaveClient live] Hyper gateway unavailable, using public gateways:', error)
      await hyperTunnel?.close().catch(() => {})
      hyperTunnel = undefined
    }
  }, 4 * LIVE_GATEWAYS.length * PROBE_TIMEOUT_MS)

  afterAll(async () => {
    setPreferredArweaveReadBaseUrls([])
    if (previousReadGateways === undefined) delete process.env.ARWEAVE_READ_GATEWAYS
    else process.env.ARWEAVE_READ_GATEWAYS = previousReadGateways
    BaseArweaveClient.setPreferredReadGateway(DEFAULT_ARWEAVE_HOST)
    invalidateReadGatewayCache()
    await hyperTunnel?.close()
  })

  it('finds a gateway that serves the known transaction', () => {
    expect(gateway, `no gateway served ${KNOWN_TX_ID}: ${JSON.stringify(probes)}`).toBeDefined()
  })

  it('reports the known transaction as present and an unknown one as absent', async () => {
    expect(await BaseArweaveClient.getTransactionStatus(KNOWN_TX_ID)).toEqual({ status: 200, confirmed: null })
    const missing = await BaseArweaveClient.getTransactionStatus(MISSING_TX_ID)
    expect(missing.status).not.toBe(200)
  }, NETWORK_TIMEOUT)

  it('reads the known transaction and its tags', async () => {
    const data = await BaseArweaveClient.getTransactionData(KNOWN_TX_ID)
    expect((data as Uint8Array).byteLength).toBeGreaterThan(0)
    const tags = await BaseArweaveClient.getTransactionTags(KNOWN_TX_ID)
    expect(tags.some((t) => t.name === 'Content-Type')).toBe(true)
  }, NETWORK_TIMEOUT)

  it('downloads the known transaction', async () => {
    const [result] = await BaseArweaveClient.downloadFiles({ transactionIds: [KNOWN_TX_ID] })
    expect(result).toMatchObject({ transactionId: KNOWN_TX_ID, success: true })
    expect(result!.data!.byteLength).toBeGreaterThan(0)
  }, NETWORK_TIMEOUT)

  it('prices a new transaction with the gateway', async () => {
    const tx = await BaseArweaveClient.createTransaction('Seed Protocol live smoke test')
    expect(Number(tx.reward)).toBeGreaterThan(0)
    expect(tx.last_tx).toBeTruthy()
  }, NETWORK_TIMEOUT)
})
