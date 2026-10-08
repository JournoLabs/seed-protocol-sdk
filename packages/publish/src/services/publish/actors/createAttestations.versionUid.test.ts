import { describe, expect, mock, test } from 'bun:test'
import { encodeAbiParameters, encodeEventTopics } from 'viem'
import { executorEventsAbi } from '../../../helpers/abi/executor'

/**
 * A patch publish via the modular executor attaches to an existing version; its SeedPublished
 * event still reports that version's uid. It must not be recorded as a new version.
 */
const updateVersionUid = mock(async (_: unknown) => {})

mock.module('@seedprotocol/sdk', () => ({
  updateVersionUid,
  Item: {},
}))
// Only CreatedAttestation/SeedPublished parsing is exercised here; easDirect pulls in publish config.
mock.module('../../../helpers/easDirect', () => ({ getAttestedUidsFromReceipt: () => [] }))
mock.module('../helpers/receiptAttestationMs', () => ({
  attestationMsFromReceipt: async () => 1_700_000_000_000,
}))

const MODULE = '0x00000000000000000000000000000000000000aa' as `0x${string}`
const SEED_UID = `0x${'5'.repeat(64)}` as `0x${string}`
const VERSION_UID = `0x${'6'.repeat(64)}` as `0x${string}`
const ZERO = `0x${'0'.repeat(64)}`

const seedPublishedReceipt = () => ({
  logs: [
    {
      address: MODULE,
      topics: encodeEventTopics({ abi: executorEventsAbi, eventName: 'SeedPublished' }),
      data: encodeAbiParameters(
        [
          { type: 'bytes32', name: 'seedUid' },
          { type: 'bytes32', name: 'versionUid' },
        ],
        [SEED_UID, VERSION_UID],
      ),
    },
  ],
})

const { persistVersionUidFromPublishReceipt } = await import('./persistVersionUid')

const persist = (requestVersionUid: string | undefined) =>
  persistVersionUidFromPublishReceipt({
    receipt: seedPublishedReceipt() as any,
    seedLocalId: 'seedLocal01',
    requestVersionUid,
    versionSchemaUid: `0x${'7'.repeat(64)}`,
    contractAddressForEvents: MODULE,
    listOfAttestationsCount: 2,
    useModularExecutor: true,
    publisherAddress: '0x' + '1'.repeat(40),
  })

describe('persistVersionUidFromPublishReceipt (modular executor)', () => {
  test('patch publish (request carried the version uid): records no new version', async () => {
    updateVersionUid.mockClear()
    await persist(VERSION_UID)
    expect(updateVersionUid).not.toHaveBeenCalled()
  })

  test('new version (request version uid zero): records the SeedPublished version uid', async () => {
    updateVersionUid.mockClear()
    await persist(ZERO)
    expect(updateVersionUid).toHaveBeenCalledTimes(1)
    expect(updateVersionUid.mock.calls[0]![0]).toMatchObject({
      seedLocalId: 'seedLocal01',
      versionUid: VERSION_UID,
    })
  })
})
