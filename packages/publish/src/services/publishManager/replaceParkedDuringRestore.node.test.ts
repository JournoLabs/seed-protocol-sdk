import { afterAll, beforeAll, expect, mock, test } from 'bun:test'
import { ethers } from 'ethers'

/**
 * Publish sent while restore is still running (ADR 0036): restore brings back a run parked after a
 * failed attestation, and the Publish replaces it once restore has ended, rather than finding it in
 * the way and reporting `already_publishing`.
 */
const realSdk = await import('@seedprotocol/sdk')
const realSavePublish = await import('./actors/savePublish')

mock.module('@seedprotocol/sdk', () => ({
  ...realSdk,
  findOpenPublishAttempts: async () => [],
  findPublishAttemptsByNonceKey: async () => [],
}))
mock.module('./actors/savePublish', () => ({
  ...realSavePublish,
  markInProgressPublishInterrupted: async () => {},
}))

const { createActor, fromCallback } = await import('xstate')

/** The run restore brings back; set once the publish machine can be imported. */
let parked: import('xstate').AnyActorRef
/** Ends the restore with `parked`. */
let finishRestore: () => void = () => {}
// Mocked before anything imports the manager.
mock.module('./actors/restoreFromDb', () => ({
  // The real module imports the manager, so it isn't spread here.
  restoreWhenDbReady: fromCallback(() => {}),
  restoreFromDb: fromCallback(({ sendBack }) => {
    finishRestore = () => {
      parked.start()
      sendBack({
        type: 'RESTORE_FROM_DB_DONE',
        publishProcesses: new Map([[item.seedLocalId, parked]]),
        subscriptions: new Map(),
        status: { outcome: 'restored' },
      })
    }
  }),
}))

const ADDRESS = ethers.Wallet.createRandom().address
const item = {
  seedLocalId: 'seed-restored-parked',
  modelName: 'Post',
  schemaUid: '0xschema',
  // An item no cache holds: createPublish takes no hold on it.
  getService: () => ({ getSnapshot: () => ({ status: 'stopped' }) }),
} as unknown as import('@seedprotocol/sdk').Item<Record<string, unknown>>

const { publishMachine } = await import('../publish')
parked = createActor(publishMachine, {
  snapshot: publishMachine.resolveState({
    value: 'attestationFailureRecoverable',
    context: { item, address: ADDRESS, publishRunId: 'run-parked' } as never,
  }),
})

const { BaseDb } = realSdk
const { setConfigRef } = await import('../../config')
const { fromEthersWallet } = await import('../../helpers/seedSigner')
const { PublishManager } = await import('./index')
const { startPublish } = await import('../../helpers/ensureWalletThenPublish')
const { TEST_TIMEOUT_MS } = await import('../../../test-utils/waitUntil')

const origReady = BaseDb.isAppDbReady.bind(BaseDb)

beforeAll(() => {
  setConfigRef({ uploadApiBaseUrl: 'http://127.0.0.1:9', rpcUrl: 'https://example.invalid/rpc' })
  BaseDb.isAppDbReady = () => true
  void PublishManager.ready()
})

afterAll(() => {
  BaseDb.isAppDbReady = origReady
  PublishManager.stopAll()
})

test('a Publish sent during restore replaces the parked run restore brings back', async () => {
  expect(PublishManager.getService().getSnapshot().value).toBe('restoreFromDb')
  const started = startPublish(item, ADDRESS, fromEthersWallet(ethers.Wallet.createRandom()))
  await new Promise((resolve) => setTimeout(resolve, 0))
  finishRestore()
  const result = await started
  expect(result.outcome).toBe('started')
  expect(parked.getSnapshot().status).toBe('stopped')
}, TEST_TIMEOUT_MS)
