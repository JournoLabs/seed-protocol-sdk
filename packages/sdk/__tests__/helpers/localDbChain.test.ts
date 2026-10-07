import { describe, it, expect, afterAll, beforeEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { configureEasReadChain, expectEasReadChain, getEasReadChainId, resetEasReadChain } from '@seedprotocol/eas'
import { BaseDb } from '@/db/Db/BaseDb'
import { appState, seeds } from '@/seedSchema'
import {
  assertLocalDbChain,
  EAS_CHAIN_ID_APP_STATE_KEY,
  loadLocalDbChain,
  waitForEasReadChain,
} from '@/helpers/localDbChain'

// Own in-memory DB: the shared client harness reuses a DB whose file a previous test file
// already deleted, which makes writes fail with SQLITE_READONLY_DBMOVED.
let db: ReturnType<typeof drizzle>
// Restore only our spy: this suite runs with isolate: false, so restoreAllMocks would reset
// other files' mocks in the same process.
let getAppDbSpy: { mockRestore: () => void } | undefined

async function freshDb() {
  const client = createClient({ url: ':memory:' })
  await client.executeMultiple(`
    CREATE TABLE appState (key text UNIQUE, value text, created_at integer, updated_at integer);
    CREATE TABLE seeds (local_id text UNIQUE, uid text, schema_uid text, type text, model_file_id text, publisher text,
      attestation_raw text, attestation_created_at integer, created_at integer, updated_at integer,
      _marked_for_deletion integer, revoked_at integer);
  `)
  db = drizzle(client)
  getAppDbSpy?.mockRestore()
  getAppDbSpy = vi.spyOn(BaseDb, 'getAppDb').mockReturnValue(db as unknown as ReturnType<typeof BaseDb.getAppDb>)
}

const testDescribe = typeof window === 'undefined' ? describe : describe.skip

const ATTESTED_LOCAL_ID = 'localDbChainTestSeed'

async function recordedChainId(): Promise<string | undefined> {
  const rows = await db
    .select({ value: appState.value })
    .from(appState)
    .where(eq(appState.key, EAS_CHAIN_ID_APP_STATE_KEY))
  return rows[0]?.value ?? undefined
}

async function recordChain(chainId: number) {
  await db
    .insert(appState)
    .values({ key: EAS_CHAIN_ID_APP_STATE_KEY, value: String(chainId) })
    .onConflictDoUpdate({ target: appState.key, set: { value: String(chainId) } })
}

async function addAttestedSeed() {
  await db.insert(seeds).values({
    localId: ATTESTED_LOCAL_ID,
    uid: `0x${'ab'.repeat(32)}`,
    schemaUid: `0x${'cd'.repeat(32)}`,
  })
}

testDescribe('local DB chain', () => {
  afterAll(() => {
    resetEasReadChain()
    getAppDbSpy?.mockRestore()
  })

  beforeEach(async () => {
    resetEasReadChain()
    await freshDb()
  })

  it('records the configured chain on a DB without attestations', async () => {
    configureEasReadChain('sdk', { chainId: 8453 })
    await assertLocalDbChain()
    expect(await recordedChainId()).toBe('8453')
  })

  it('treats an unrecorded DB with attestations as Optimism Sepolia', async () => {
    await addAttestedSeed()
    await assertLocalDbChain()
    expect(await recordedChainId()).toBe('11155420')
    expect(getEasReadChainId()).toBe(11155420)
  })

  it('refuses to write when the DB holds another chain', async () => {
    await recordChain(11155420)
    configureEasReadChain('publish', { chainId: 8453 })
    await expect(assertLocalDbChain()).rejects.toThrow(
      /local database holds attestations from chain 11155420, but the app is configured for chain 8453/,
    )
  })

  it('init makes reads follow the recorded chain and rejects a different configured chain', async () => {
    await recordChain(8453)
    await loadLocalDbChain()
    expect(getEasReadChainId()).toBe(8453)
    expect(() => configureEasReadChain('publish', { chainId: 10 })).toThrow(/chain mismatch/)
  })

  it('init leaves an empty DB unrecorded when no chain is configured', async () => {
    await loadLocalDbChain()
    expect(await recordedChainId()).toBeUndefined()
  })

  it('sync waits for initPublish when publish is loaded, and warns if it never comes', async () => {
    expectEasReadChain('publish')
    const waiting = waitForEasReadChain(5_000)
    configureEasReadChain('publish', { chainId: 8453 })
    await waiting
    expect(getEasReadChainId()).toBe(8453)

    resetEasReadChain()
    expectEasReadChain('publish')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await waitForEasReadChain(10)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Set SeedConfig.eas.chainId'))
    } finally {
      warn.mockRestore()
    }
  })
})
