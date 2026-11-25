import { describe, expect, mock, test } from 'bun:test'
import { encodeAbiParameters, encodeEventTopics, zeroAddress } from 'viem'
import { easAbi } from '../../../helpers/abi/eas'

/**
 * Batch 18 item 6 (D67): the uids of the parts of a run that an earlier try recorded, read from
 * their attempt rows; a row from before the column existed is read from its receipt.
 */
const realSdk = await import('@seedprotocol/sdk')
const realConfig = await import('../../../config')
const realChainClient = await import('../../../helpers/chainClient')

const EAS = '0x00000000000000000000000000000000000000ea' as `0x${string}`
const ATTESTER = '0x00000000000000000000000000000000000000bb' as `0x${string}`
const ZERO = `0x${'0'.repeat(64)}`
const h = (c: string) => `0x${c.repeat(64)}` as `0x${string}`
const SCHEMA_SEED = h('1')
const SCHEMA_VERSION = h('2')
const SCHEMA_TITLE = h('3')

type Row = { id: string; txHash: string | null; attestationUids: string | null; requests: string; attester: string }
let rows: Row[] = []
const receiptsRead: string[] = []
const attested = (schemaUID: `0x${string}`, uid: `0x${string}`) => ({
  address: EAS,
  topics: encodeEventTopics({ abi: easAbi, eventName: 'Attested', args: { recipient: zeroAddress, attester: ATTESTER, schemaUID } }),
  data: encodeAbiParameters([{ type: 'bytes32' }], [uid]),
})

mock.module('@seedprotocol/sdk', () => ({ ...realSdk, findRecordedPublishParts: async () => rows }))
mock.module('../../../config', () => ({ ...realConfig, getPublishConfig: () => ({ easContractAddress: EAS }) }))
mock.module('../../../helpers/chainClient', () => ({
  ...realChainClient,
  waitForPublishReceipt: async (hash: string) => {
    receiptsRead.push(hash)
    return {
      logs: [attested(SCHEMA_SEED, h('a')), attested(SCHEMA_VERSION, h('b')), attested(SCHEMA_TITLE, h('c'))],
    }
  },
}))

const { earlierPartUids } = await import('./earlierPartUids')

const sentRequests = JSON.stringify([
  {
    localId: 'post0001',
    seedUid: ZERO,
    seedSchemaUid: SCHEMA_SEED,
    versionUid: ZERO,
    versionSchemaUid: SCHEMA_VERSION,
    listOfAttestations: [{ schema: SCHEMA_TITLE, data: [{ expirationTime: '0', value: '0', data: '0x' }], _propertyName: 'title' }],
  },
])

describe('earlierPartUids', () => {
  test('reads the uids a part stored, in the order the parts recorded', async () => {
    rows = [
      { id: 'p1', txHash: h('7'), attestationUids: JSON.stringify([h('1'), h('2')]), requests: sentRequests, attester: ATTESTER },
      { id: 'p2', txHash: h('8'), attestationUids: JSON.stringify([h('3')]), requests: sentRequests, attester: ATTESTER },
    ]
    receiptsRead.length = 0
    expect(await earlierPartUids('run-1', new Set())).toEqual([h('1'), h('2'), h('3')])
    expect(receiptsRead).toEqual([])
  })

  test('leaves out the parts this try recorded', async () => {
    rows = [
      { id: 'p1', txHash: h('7'), attestationUids: JSON.stringify([h('1')]), requests: sentRequests, attester: ATTESTER },
      { id: 'p2', txHash: h('8'), attestationUids: JSON.stringify([h('3')]), requests: sentRequests, attester: ATTESTER },
    ]
    expect(await earlierPartUids('run-1', new Set(['p2']))).toEqual([h('1')])
  })

  test('a row recorded before the column existed is read from its receipt by tx_hash', async () => {
    rows = [{ id: 'old', txHash: h('7'), attestationUids: null, requests: sentRequests, attester: ATTESTER }]
    receiptsRead.length = 0
    expect(await earlierPartUids('run-1', new Set())).toEqual([h('a'), h('b'), h('c')])
    expect(receiptsRead).toEqual([h('7')])
  })

  test('a row with neither stored uids nor a transaction adds nothing, and does not throw', async () => {
    rows = [{ id: 'old', txHash: null, attestationUids: null, requests: sentRequests, attester: ATTESTER }]
    expect(await earlierPartUids('run-1', new Set())).toEqual([])
  })

  test('is empty without a run id', async () => {
    rows = [{ id: 'p1', txHash: h('7'), attestationUids: JSON.stringify([h('1')]), requests: sentRequests, attester: ATTESTER }]
    expect(await earlierPartUids(undefined, new Set())).toEqual([])
  })
})
