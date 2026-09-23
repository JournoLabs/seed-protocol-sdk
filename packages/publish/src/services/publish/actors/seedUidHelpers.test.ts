import { describe, expect, test } from 'bun:test'
import { encodeAbiParameters, encodeEventTopics, zeroAddress, zeroHash } from 'viem'
import { publisherEventsAbi } from '../../../helpers/abi/publisher'
import { executorEventsAbi } from '../../../helpers/abi/executor'
import { easAbi } from '../../../helpers/abi/eas'
import { EAS_CONTRACT_ADDRESS } from '../../../helpers/constants'
import { getAttestedUidsFromReceipt } from '../../../helpers/easDirect'
import {
  listCreatedAttestationPairsFromReceipt,
  listPropertyAttestationPairsFromReceipt,
} from './seedUidHelpers'

const SCHEMA_UID = `0x${'1'.repeat(64)}` as `0x${string}`
const ATTESTATION_UID = `0x${'a'.repeat(64)}` as `0x${string}`

function createdAttestationLog(
  abi: typeof publisherEventsAbi | typeof executorEventsAbi,
  schemaUid: `0x${string}`,
  attestationUid: `0x${string}`,
) {
  const topics = encodeEventTopics({
    abi,
    eventName: 'CreatedAttestation',
  })
  const data = encodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          { name: 'schemaUid', type: 'bytes32' },
          { name: 'attestationUid', type: 'bytes32' },
        ],
      },
    ],
    [{ schemaUid, attestationUid }],
  )
  return {
    address: '0x1111111111111111111111111111111111111111' as `0x${string}`,
    data,
    topics,
  }
}

describe('listCreatedAttestationPairsFromReceipt', () => {
  test('returns schemaUid + attestationUid pairs from publisher CreatedAttestation logs', () => {
    const receipt = {
      logs: [createdAttestationLog(publisherEventsAbi, SCHEMA_UID, ATTESTATION_UID)],
    }
    expect(listCreatedAttestationPairsFromReceipt(receipt, false)).toEqual([
      { schemaUid: SCHEMA_UID, attestationUid: ATTESTATION_UID },
    ])
  })

  test('returns pairs from modular executor CreatedAttestation logs', () => {
    const receipt = {
      logs: [createdAttestationLog(executorEventsAbi, SCHEMA_UID, ATTESTATION_UID)],
    }
    expect(listCreatedAttestationPairsFromReceipt(receipt, true)).toEqual([
      { schemaUid: SCHEMA_UID, attestationUid: ATTESTATION_UID },
    ])
  })

  test('skips zero attestation UIDs', () => {
    const receipt = {
      logs: [createdAttestationLog(publisherEventsAbi, SCHEMA_UID, zeroHash)],
    }
    expect(listCreatedAttestationPairsFromReceipt(receipt, false)).toEqual([])
  })

  test('returns empty when logs are missing', () => {
    expect(listCreatedAttestationPairsFromReceipt({}, false)).toEqual([])
    expect(listCreatedAttestationPairsFromReceipt({ logs: [] }, false)).toEqual([])
  })

  test('returns empty when logs do not match CreatedAttestation', () => {
    const receipt = {
      logs: [
        {
          address: '0x1111111111111111111111111111111111111111',
          data: '0x',
          topics: [`0x${'b'.repeat(64)}`],
        },
      ],
    }
    expect(listCreatedAttestationPairsFromReceipt(receipt, false)).toEqual([])
  })
})

const PUBLISHER = '0x1111111111111111111111111111111111111111' as `0x${string}`
const SCHEMA_SEED = `0x${'3'.repeat(64)}` as `0x${string}`
const SCHEMA_VERSION = `0x${'4'.repeat(64)}` as `0x${string}`
const SCHEMA_TITLE = `0x${'5'.repeat(64)}` as `0x${string}`
const UID_SEED = `0x${'b'.repeat(64)}` as `0x${string}`
const UID_VERSION = `0x${'c'.repeat(64)}` as `0x${string}`
const UID_TITLE = `0x${'d'.repeat(64)}` as `0x${string}`

function attestedLog(
  schemaUid: `0x${string}`,
  uid: `0x${string}`,
  address: `0x${string}` = EAS_CONTRACT_ADDRESS,
) {
  const topics = encodeEventTopics({
    abi: easAbi,
    eventName: 'Attested',
    args: {
      recipient: zeroAddress,
      attester: PUBLISHER,
      schemaUID: schemaUid,
    },
  })
  const data = encodeAbiParameters([{ type: 'bytes32' }], [uid])
  return { address, data, topics }
}

function modularSeedPublishedLog(
  address: `0x${string}`,
  seedUid: `0x${string}`,
  versionUid: `0x${string}`,
) {
  const topics = encodeEventTopics({
    abi: executorEventsAbi,
    eventName: 'SeedPublished',
  })
  const data = encodeAbiParameters(
    [
      { type: 'bytes32', name: 'seedUid' },
      { type: 'bytes32', name: 'versionUid' },
    ],
    [seedUid, versionUid],
  )
  return { address, data, topics }
}

function publisherSeedPublishedLog(address: `0x${string}`, uids: readonly `0x${string}`[]) {
  const topics = encodeEventTopics({
    abi: publisherEventsAbi,
    eventName: 'SeedPublished',
  })
  const encodedArray = encodeAbiParameters([{ type: 'bytes32[]' }], [uids])
  const data = encodeAbiParameters([{ type: 'bytes' }], [encodedArray])
  return { address, data, topics }
}

describe('getAttestedUidsFromReceipt', () => {
  test('returns schemaUid + uid pairs from EAS Attested logs', () => {
    const receipt = {
      logs: [attestedLog(SCHEMA_TITLE, UID_TITLE)],
    }
    expect(getAttestedUidsFromReceipt(receipt, EAS_CONTRACT_ADDRESS)).toEqual([
      { schemaUid: SCHEMA_TITLE, uid: UID_TITLE },
    ])
  })

  test('returns empty when logs are from a different address', () => {
    const receipt = {
      logs: [attestedLog(SCHEMA_TITLE, UID_TITLE, PUBLISHER)],
    }
    expect(getAttestedUidsFromReceipt(receipt, EAS_CONTRACT_ADDRESS)).toEqual([])
  })

  test('returns empty when logs are missing', () => {
    expect(getAttestedUidsFromReceipt({}, EAS_CONTRACT_ADDRESS)).toEqual([])
    expect(getAttestedUidsFromReceipt({ logs: [] }, EAS_CONTRACT_ADDRESS)).toEqual([])
  })
})

describe('listPropertyAttestationPairsFromReceipt', () => {
  test('prefers CreatedAttestation over Attested', () => {
    const receipt = {
      logs: [
        createdAttestationLog(publisherEventsAbi, SCHEMA_UID, ATTESTATION_UID),
        attestedLog(SCHEMA_TITLE, UID_TITLE),
      ],
    }
    expect(
      listPropertyAttestationPairsFromReceipt({
        receipt,
        useModularExecutor: false,
        easContractAddress: EAS_CONTRACT_ADDRESS,
        contractAddressForEvents: PUBLISHER,
      }),
    ).toEqual([{ schemaUid: SCHEMA_UID, attestationUid: ATTESTATION_UID }])
  })

  test('falls back to EAS Attested when CreatedAttestation is missing', () => {
    const receipt = {
      logs: [
        attestedLog(SCHEMA_SEED, UID_SEED),
        attestedLog(SCHEMA_VERSION, UID_VERSION),
        attestedLog(SCHEMA_TITLE, UID_TITLE),
      ],
    }
    expect(
      listPropertyAttestationPairsFromReceipt({
        receipt,
        useModularExecutor: true,
        easContractAddress: EAS_CONTRACT_ADDRESS,
        contractAddressForEvents: PUBLISHER,
      }),
    ).toEqual([
      { schemaUid: SCHEMA_SEED, attestationUid: UID_SEED },
      { schemaUid: SCHEMA_VERSION, attestationUid: UID_VERSION },
      { schemaUid: SCHEMA_TITLE, attestationUid: UID_TITLE },
    ])
  })

  test('modular SeedPublished alone is not a property source', () => {
    const receipt = {
      logs: [modularSeedPublishedLog(PUBLISHER, UID_SEED, UID_VERSION)],
    }
    expect(
      listPropertyAttestationPairsFromReceipt({
        receipt,
        useModularExecutor: true,
        easContractAddress: EAS_CONTRACT_ADDRESS,
        contractAddressForEvents: PUBLISHER,
      }),
    ).toEqual([])
  })

  test('non-modular SeedPublished bytes32[0..n-1] zips with list schemas when earlier sources are empty', () => {
    const receipt = {
      logs: [publisherSeedPublishedLog(PUBLISHER, [UID_TITLE, UID_SEED, UID_VERSION])],
    }
    expect(
      listPropertyAttestationPairsFromReceipt({
        receipt,
        useModularExecutor: false,
        easContractAddress: EAS_CONTRACT_ADDRESS,
        contractAddressForEvents: PUBLISHER,
        listOfAttestations: [{ schema: SCHEMA_TITLE }],
      }),
    ).toEqual([{ schemaUid: SCHEMA_TITLE, attestationUid: UID_TITLE }])
  })
})
