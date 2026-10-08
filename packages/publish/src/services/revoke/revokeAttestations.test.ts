import { afterEach, describe, expect, mock, test } from 'bun:test'
import { decodeFunctionData } from 'viem'
import { easAbi } from '~/helpers/abi/eas'

const MANAGED = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const SESSION_KEY = '0x5e55105e55105e55105e55105e55105e55105e55'
const EXECUTOR = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const EAS = '0x4200000000000000000000000000000000000021'
const SEED_UID = `0x${'11'.repeat(32)}`
const SEED_SCHEMA = `0x${'22'.repeat(32)}`

const state = {
  attester: MANAGED,
  signer: MANAGED,
  automationActive: false,
  sent: [] as Array<{ to: string; data: `0x${string}` }>,
  revokedAt: null as number | null,
  revokedMetadataUids: null as string[] | null,
  revokedVersionUids: null as string[] | null,
  versions: [] as { uid: string }[],
  metadata: [] as { uid: string; schemaUid: string }[],
}

const sdkActual = await import('@seedprotocol/sdk')
mock.module('@seedprotocol/sdk', () => ({
  ...sdkActual,
  assertLocalDbChain: async () => {},
  getAttesterForSeed: async () => state.attester,
  getVersionsForSeedUid: async () => state.versions,
  getMetadataAttestationUidsForSeedUid: async () => state.metadata,
  getGetAdditionalSyncAddresses: () => async () => [EXECUTOR],
  updateSeedRevokedAt: async ({
    revokedAt,
    metadataUids,
    versionUids,
  }: {
    revokedAt: number
    metadataUids?: string[]
    versionUids?: string[]
  }) => {
    state.revokedAt = revokedAt
    state.revokedMetadataUids = metadataUids ?? null
    state.revokedVersionUids = versionUids ?? null
  },
}))

mock.module('~/helpers/verifyPublishChain', () => ({ verifyPublishChain: async () => {} }))

const chainClientActual = await import('~/helpers/chainClient')
mock.module('~/helpers/chainClient', () => ({
  ...chainClientActual,
  waitForPublishReceipt: async () => ({ status: 'success' }),
}))

mock.module('~/helpers/ensureAutomationSessionKey', () => ({
  isAutomationSessionActive: async () => state.automationActive,
}))

mock.module('~/helpers/publishWalletRegistry', () => ({
  getPublishWallet: () => ({
    signer: { address: state.signer },
    txSender: {
      address: state.signer,
      sendTransaction: async (tx: { to: string; data: `0x${string}` }) => {
        state.sent.push(tx)
        return { transactionHash: `0x${'12'.repeat(32)}` }
      },
    },
  }),
}))

const { setConfigRef } = await import('~/config')
const { revokeAttestations } = await import('./revokeAttestations')

setConfigRef({
  uploadApiBaseUrl: 'https://example.com',
  rpcUrl: 'https://rpc.invalid',
  modularAccountModuleContract: EXECUTOR,
})

afterEach(() => {
  state.attester = MANAGED
  state.signer = MANAGED
  state.automationActive = false
  state.sent = []
  state.revokedAt = null
  state.revokedMetadataUids = null
  state.revokedVersionUids = null
  state.versions = []
  state.metadata = []
})

const params = { seedLocalId: 'seed1', seedUid: SEED_UID, seedSchemaUid: SEED_SCHEMA }

describe('revokeAttestations', () => {
  test('marks the revoked property attestations along with the seed', async () => {
    const titleUid = `0x${'31'.repeat(32)}`
    const bodyUid = `0x${'32'.repeat(32)}`
    state.metadata = [
      { uid: titleUid, schemaUid: `0x${'41'.repeat(32)}` },
      { uid: bodyUid, schemaUid: `0x${'42'.repeat(32)}` },
    ]
    await revokeAttestations(params)
    expect(state.revokedAt).not.toBeNull()
    expect(state.revokedMetadataUids?.slice().sort()).toEqual([titleUid, bodyUid].sort())
  })

  test('marks the revoked version attestations along with the seed', async () => {
    const v1 = `0x${'51'.repeat(32)}`
    const v2 = `0x${'52'.repeat(32)}`
    state.versions = [{ uid: v1 }, { uid: v2 }]
    await revokeAttestations(params)
    expect(state.revokedVersionUids?.slice().sort()).toEqual([v1, v2].sort())
  })

  test('the owner revokes through EAS, never the executor', async () => {
    await revokeAttestations(params)
    expect(state.sent).toHaveLength(1)
    expect(state.sent[0]?.to.toLowerCase()).toBe(EAS)
    expect(decodeFunctionData({ abi: easAbi, data: state.sent[0]!.data }).functionName).toBe('multiRevoke')
    expect(state.revokedAt).not.toBeNull()
  })

  test('automation session keys are refused before sending', async () => {
    state.signer = SESSION_KEY
    state.automationActive = true
    await expect(revokeAttestations(params)).rejects.toThrow('Automation session keys cannot revoke')
    expect(state.sent).toHaveLength(0)
    expect(state.revokedAt).toBeNull()
  })

  test('seeds attested by the executor itself are refused before sending', async () => {
    state.attester = EXECUTOR
    await expect(revokeAttestations(params)).rejects.toThrow('attested by the Seed executor module')
    expect(state.sent).toHaveLength(0)
  })
})
