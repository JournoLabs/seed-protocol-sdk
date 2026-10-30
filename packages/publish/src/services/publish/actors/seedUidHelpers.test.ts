import { describe, expect, test } from 'bun:test'
import { encodeAbiParameters, encodeEventTopics, zeroAddress } from 'viem'
import { easAbi } from '../../../helpers/abi/eas'
import { EAS_CONTRACT_ADDRESS } from '../../../helpers/constants'
import { getAttestationUidFromReceipt, getAttestedUidsFromReceipt } from '../../../helpers/easDirect'

const SCHEMA_TITLE = `0x${'2'.repeat(64)}` as `0x${string}`
const UID_TITLE = `0x${'b'.repeat(64)}` as `0x${string}`
const OTHER_UID = `0x${'c'.repeat(64)}` as `0x${string}`
const PUBLISHER = '0x00000000000000000000000000000000000000bb' as `0x${string}`
const OTHER_ACCOUNT = '0x00000000000000000000000000000000000000cc' as `0x${string}`

function attestedLog(
  schemaUid: `0x${string}`,
  uid: `0x${string}`,
  address: `0x${string}` = EAS_CONTRACT_ADDRESS,
  attester: `0x${string}` = PUBLISHER,
) {
  const topics = encodeEventTopics({
    abi: easAbi,
    eventName: 'Attested',
    args: { recipient: zeroAddress, attester, schemaUID: schemaUid },
  })
  return { address, data: encodeAbiParameters([{ type: 'bytes32' }], [uid]), topics }
}

describe('getAttestedUidsFromReceipt', () => {
  test('returns schemaUid + uid pairs from EAS Attested logs', () => {
    const receipt = { logs: [attestedLog(SCHEMA_TITLE, UID_TITLE)] }
    expect(getAttestedUidsFromReceipt(receipt, EAS_CONTRACT_ADDRESS, PUBLISHER)).toEqual([
      { schemaUid: SCHEMA_TITLE, uid: UID_TITLE },
    ])
  })

  test('returns empty when logs are from a different address', () => {
    const receipt = { logs: [attestedLog(SCHEMA_TITLE, UID_TITLE, PUBLISHER)] }
    expect(getAttestedUidsFromReceipt(receipt, EAS_CONTRACT_ADDRESS, PUBLISHER)).toEqual([])
  })

  test("leaves out another attester's attestations", () => {
    const receipt = {
      logs: [
        attestedLog(SCHEMA_TITLE, OTHER_UID, EAS_CONTRACT_ADDRESS, OTHER_ACCOUNT),
        attestedLog(SCHEMA_TITLE, UID_TITLE),
      ],
    }
    expect(getAttestedUidsFromReceipt(receipt, EAS_CONTRACT_ADDRESS, PUBLISHER)).toEqual([
      { schemaUid: SCHEMA_TITLE, uid: UID_TITLE },
    ])
    expect(getAttestationUidFromReceipt(receipt, EAS_CONTRACT_ADDRESS, PUBLISHER)).toBe(UID_TITLE)
  })

  test('returns empty when logs are missing', () => {
    expect(getAttestedUidsFromReceipt({}, EAS_CONTRACT_ADDRESS, PUBLISHER)).toEqual([])
    expect(getAttestedUidsFromReceipt({ logs: [] }, EAS_CONTRACT_ADDRESS, PUBLISHER)).toEqual([])
  })
})
