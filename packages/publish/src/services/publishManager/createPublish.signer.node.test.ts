import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { ethers } from 'ethers'
import { setConfigRef } from '../../config'
import { fromEthersWallet, type PublishWallet } from '../../helpers/seedSigner'
import { getPublishWallet, setPublishWallet, type PublishWalletSession } from '../../helpers/publishWalletRegistry'
import { directEasProblem } from '../publish/helpers/undeployedSmartAccount'
import { TEST_TIMEOUT_MS } from '../../../test-utils/waitUntil'

const BASE_CONFIG = { uploadApiBaseUrl: 'http://127.0.0.1:9', rpcUrl: 'https://example.invalid/rpc' }

let n = 0
const item = () =>
  ({
    seedLocalId: `seed-signer-${++n}`,
    modelName: 'Post',
    schemaUid: '0xschema',
    // An item no cache holds: createPublish takes no hold on it.
    getService: () => ({ getSnapshot: () => ({ status: 'stopped' }) }),
  }) as unknown as import('@seedprotocol/sdk').Item<Record<string, unknown>>

const eoa = () => fromEthersWallet(ethers.Wallet.createRandom())

/** Registers the session without waiting for the Seed client, which these tests don't start. */
function registerSession(next: PublishWalletSession) {
  void setPublishWallet(next)
  expect(getPublishWallet()).toBe(next)
}

async function spawnedSigner(wallet: PublishWallet | undefined, address: string, options?: object) {
  const { PublishManager } = await import('./index')
  await PublishManager.ready()
  const actor = await PublishManager.createPublish(item(), address, wallet, options as never)
  expect(actor).toBeDefined()
  const signer = actor!.getSnapshot().context.dataItemSigner
  PublishManager.stopAll()
  return signer
}

afterEach(() => {
  void setPublishWallet(null)
  setConfigRef(BASE_CONFIG)
})

afterAll(() => {
  delete process.env.SEED_PUBLISH_RESTORE_WAIT_MS
})

describe('createPublish data item signer', () => {
  process.env.SEED_PUBLISH_RESTORE_WAIT_MS = '0'
  setConfigRef(BASE_CONFIG)

  test("defaults to the registered session's dataItemSigner when it publishes as the address", async () => {
    // A modular-executor session: the in-app EOA publishes as a ManagedAccount, and a separate
    // key signs data items.
    const inApp = { ...eoa(), kind: 'modular' as const }
    const dataItems = eoa().signer
    const managed = ethers.Wallet.createRandom().address
    registerSession({ ...inApp, publisherAddress: managed, dataItemSigner: dataItems })

    expect(await spawnedSigner(inApp, managed)).toBe(dataItems)
    // Another publisher: the session's signer isn't this publish's.
    expect(await spawnedSigner(inApp, ethers.Wallet.createRandom().address)).toBe(inApp.signer)
  }, TEST_TIMEOUT_MS)

  test("defaults to an EOA or modular wallet's signer, never a smart account's", async () => {
    const plain = eoa()
    expect(await spawnedSigner(plain, plain.signer.address)).toBe(plain.signer)
    const modular = { ...eoa(), kind: 'modular' as const }
    expect(await spawnedSigner(modular, ethers.Wallet.createRandom().address)).toBe(modular.signer)
    const smart = { ...eoa(), kind: 'smart' as const }
    expect(await spawnedSigner(smart, smart.signer.address)).toBeUndefined()
  }, TEST_TIMEOUT_MS)

  test("a caller's signer wins, then the config's", async () => {
    const plain = eoa()
    const explicit = eoa().signer
    const configured = eoa().signer
    expect(await spawnedSigner(plain, plain.signer.address, { dataItemSigner: explicit })).toBe(explicit)
    setConfigRef({ ...BASE_CONFIG, dataItemSigner: configured })
    expect(await spawnedSigner(plain, plain.signer.address)).toBe(configured)
    expect(await spawnedSigner(plain, plain.signer.address, { dataItemSigner: explicit })).toBe(explicit)
  }, TEST_TIMEOUT_MS)
})

describe("kind: 'modular'", () => {
  test('is refused for direct EAS like a smart account', () => {
    const wallet = { ...eoa(), kind: 'modular' as const }
    // Same sender and publisher, so the refusal comes from the kind.
    expect(directEasProblem(wallet.signer.address, wallet)).toBe('smart_account')
  })
})
