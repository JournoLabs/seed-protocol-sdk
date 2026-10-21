import { afterEach, describe, expect, mock, test } from 'bun:test'
import { decodeFunctionData } from 'viem'
import { easAbi } from '~/helpers/abi/eas'

const MANAGED = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const SESSION_KEY = '0x5e55105e55105e55105e55105e55105e55105e55'
const EXECUTOR = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const EAS = '0x4200000000000000000000000000000000000021'
const SEED_UID = `0x${'11'.repeat(32)}`
const SEED_SCHEMA = `0x${'22'.repeat(32)}`
const ADMIN_EOA = '0xcccccccccccccccccccccccccccccccccccccccc'

const state = {
  attester: MANAGED,
  signer: MANAGED,
  automationActive: false,
  sent: [] as Array<{ to: string; data: `0x${string}`; from: string }>,
  /** Uids EAS reports as revoked (getAttestation revocationTime > 0). */
  revokedOnChain: new Set<string>(),
  /** When true, getAttestation reads fail, so only the AlreadyRevoked revert tells. */
  readsFail: false,
  readFailuresLeft: 0,
  /** Thirdweb account the connected in-app wallet resolves to for revoking (null: none connected). */
  thirdwebRevokeAccount: null as string | null,
  revokedAt: null as number | null,
  revokedMetadataUids: null as string[] | null,
  revokedVersionUids: null as string[] | null,
  versions: [] as { uid: string }[],
  metadata: [] as { uid: string; schemaUid: string }[],
  retractedUids: null as string[] | null,
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
  markPropertyAttestationsRetracted: async ({ uids }: { uids: string[] }) => {
    state.retractedUids = uids
  },
}))

mock.module('~/helpers/verifyPublishChain', () => ({ verifyPublishChain: async () => {} }))

const chainClientActual = await import('~/helpers/chainClient')
mock.module('~/helpers/chainClient', () => ({
  ...chainClientActual,
  waitForPublishReceipt: async () => ({ status: 'success' }),
  getPublishPublicClient: () => ({
    readContract: async ({ functionName, args }: { functionName: string; args: [string] }) => {
      if (functionName !== 'getAttestation') throw new Error(`unexpected read ${functionName}`)
      if (state.readsFail) throw new Error('RPC unavailable')
      if (state.readFailuresLeft > 0) {
        state.readFailuresLeft -= 1
        throw new Error('RPC unavailable')
      }
      return { revocationTime: state.revokedOnChain.has(args[0].toLowerCase()) ? 1n : 0n }
    },
  }),
}))

/** Mirrors EAS: one already-revoked uid reverts the whole multiRevoke with AlreadyRevoked(). */
function sendAs(from: string) {
  return async (tx: { to: string; data: `0x${string}` }) => {
    const { args } = decodeFunctionData({ abi: easAbi, data: tx.data })
    const uids = (args![0] as Array<{ data: Array<{ uid: string }> }>).flatMap((r) =>
      r.data.map((d) => d.uid.toLowerCase()),
    )
    if (uids.some((u) => state.revokedOnChain.has(u))) {
      // Thirdweb surfaces the revert as text carrying the raw selector, not the error name.
      throw new Error('Execution reverted with reason: 0x905e7107')
    }
    if (from.toLowerCase() !== state.attester.toLowerCase()) {
      throw new Error('Encoded error signature "0x4ca88867" not found on ABI')
    }
    for (const u of uids) state.revokedOnChain.add(u)
    state.sent.push({ ...tx, from })
    return { transactionHash: `0x${'12'.repeat(32)}` }
  }
}

mock.module('~/helpers/thirdweb', () => ({
  getConnectedAccount: async () =>
    state.thirdwebRevokeAccount ? { address: state.signer } : null,
}))

mock.module('~/helpers/resolveRevokeAccount', () => ({
  resolveRevokeAccount: async () => ({ address: state.thirdwebRevokeAccount }),
}))

mock.module('~/helpers/adapters/thirdwebAccount', () => ({
  fromThirdwebAccount: (account: { address: string }) => ({
    signer: { address: account.address },
    txSender: { address: account.address, sendTransaction: sendAs(account.address) },
  }),
}))

mock.module('~/helpers/ensureAutomationSessionKey', () => ({
  isAutomationSessionActive: async () => state.automationActive,
}))

mock.module('~/helpers/publishWalletRegistry', () => ({
  getPublishWallet: () => ({
    signer: { address: state.signer },
    txSender: { address: state.signer, sendTransaction: sendAs(state.signer) },
  }),
}))

const { setConfigRef } = await import('~/config')
const { revokeAttestations, revokePropertyAttestations } = await import('./revokeAttestations')

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
  state.revokedOnChain = new Set()
  state.readsFail = false
  state.readFailuresLeft = 0
  state.thirdwebRevokeAccount = null
  state.revokedAt = null
  state.revokedMetadataUids = null
  state.revokedVersionUids = null
  state.versions = []
  state.metadata = []
  state.retractedUids = null
})

/** The uids of each multiRevoke sent, in order. */
const sentUids = () =>
  state.sent.map((tx) => {
    const { args } = decodeFunctionData({ abi: easAbi, data: tx.data })
    return (args![0] as unknown as Array<{ data: Array<{ uid: string }> }>).flatMap((r) =>
      r.data.map((d) => d.uid.toLowerCase()),
    )
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

  test('under useModularExecutor the ManagedAccount revokes, not the registered in-app wallet', async () => {
    // ConnectButton registers the in-app admin wallet; the ManagedAccount attested.
    state.signer = ADMIN_EOA
    state.thirdwebRevokeAccount = MANAGED
    await revokeAttestations(params)
    expect(state.sent).toHaveLength(1)
    expect(state.sent[0]?.from).toBe(MANAGED)
    expect(state.revokedAt).not.toBeNull()
  })

  test('a registered wallet that is not the attester, with no account to resolve, reports AccessDenied', async () => {
    state.signer = ADMIN_EOA
    await expect(revokeAttestations(params)).rejects.toThrow('Only the original attester can revoke')
    expect(state.revokedAt).toBeNull()
  })

  const schemaA = `0x${'41'.repeat(32)}`
  const u1 = `0x${'61'.repeat(32)}`
  const u2 = `0x${'62'.repeat(32)}`
  const u3 = `0x${'63'.repeat(32)}`

  function revokedBatchUids(): string[] {
    return state.sent.flatMap((tx) => {
      const { args } = decodeFunctionData({ abi: easAbi, data: tx.data })
      return (args![0] as Array<{ data: Array<{ uid: string }> }>).flatMap((r) =>
        r.data.map((d) => d.uid.toLowerCase()),
      )
    })
  }

  test('leaves already-revoked uids out of the batch and revokes the rest', async () => {
    state.metadata = [u1, u2, u3].map((uid) => ({ uid, schemaUid: schemaA }))
    state.revokedOnChain.add(u2)
    await revokeAttestations(params)
    expect(revokedBatchUids()).toEqual([SEED_UID, u1, u3])
    expect([u1, u2, u3, SEED_UID].every((u) => state.revokedOnChain.has(u))).toBe(true)
  })

  test('an AlreadyRevoked revert matched by selector re-reads EAS and retries the rest', async () => {
    state.metadata = [u1, u2, u3].map((uid) => ({ uid, schemaUid: schemaA }))
    state.revokedOnChain.add(u2)
    // The first reads (the seed's, then one per uid) fail, so the batch goes out with u2 and
    // reverts by selector; the re-read then sees u2 as revoked.
    state.readFailuresLeft = 4
    await revokeAttestations(params)
    expect(revokedBatchUids()).toEqual([SEED_UID, u1, u3])
    expect(state.revokedAt).not.toBeNull()
  })

  test('when EAS cannot be read, a multi-uid AlreadyRevoked batch fails instead of being skipped', async () => {
    state.metadata = [u1, u2].map((uid) => ({ uid, schemaUid: schemaA }))
    state.revokedOnChain.add(u2)
    state.readsFail = true
    await expect(revokeAttestations(params)).rejects.toThrow('reverted with AlreadyRevoked')
    expect(state.revokedOnChain.has(u1)).toBe(false)
    expect(state.revokedAt).toBeNull()
  })

  test('a single already-revoked seed counts as revoked even when EAS cannot be read', async () => {
    state.revokedOnChain.add(SEED_UID)
    state.readsFail = true
    await revokeAttestations(params)
    expect(state.sent).toHaveLength(0)
    expect(state.revokedAt).not.toBeNull()
  })
})

describe('revokeAttestations order', () => {
  test('revokes the seed before its properties, so a sync in between keeps their values', async () => {
    const titleUid = `0x${'33'.repeat(32)}`
    state.metadata = [{ uid: titleUid, schemaUid: `0x${'43'.repeat(32)}` }]
    await revokeAttestations(params)
    expect(sentUids()).toEqual([[SEED_UID.toLowerCase()], [titleUid]])
  })
})

describe('revokePropertyAttestations (ADR 0021)', () => {
  const coverSchema = `0x${'44'.repeat(32)}`
  const titleSchema = `0x${'45'.repeat(32)}`
  const cover1 = `0x${'34'.repeat(32)}`
  const cover2 = `0x${'35'.repeat(32)}`
  const title = `0x${'36'.repeat(32)}`

  test('revokes one batch per schema, leaves the seed live, and records the retraction', async () => {
    await revokePropertyAttestations({
      seedLocalId: 'seed1',
      seedUid: SEED_UID,
      attestations: [
        { uid: cover1, schemaUid: coverSchema },
        { uid: title, schemaUid: titleSchema },
        { uid: cover2, schemaUid: coverSchema },
      ],
    })
    expect(sentUids()).toEqual([[cover1, cover2], [title]])
    expect(state.revokedOnChain.has(SEED_UID.toLowerCase())).toBe(false)
    expect(state.retractedUids?.slice().sort()).toEqual([cover1, cover2, title].sort())
    expect(state.revokedAt).toBeNull()
  })

  test('automation session keys are refused before sending', async () => {
    state.signer = SESSION_KEY
    state.automationActive = true
    await expect(
      revokePropertyAttestations({ seedLocalId: 'seed1', seedUid: SEED_UID, attestations: [{ uid: cover1, schemaUid: coverSchema }] }),
    ).rejects.toThrow('Automation session keys cannot revoke')
    expect(state.sent).toHaveLength(0)
    expect(state.retractedUids).toBeNull()
  })

  test('sends nothing without attestations', async () => {
    await revokePropertyAttestations({ seedLocalId: 'seed1', seedUid: SEED_UID, attestations: [] })
    expect(state.sent).toHaveLength(0)
  })
})
