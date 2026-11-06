import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createEncryptionIdentity, createEnvelopeDecryptor, createPrivateUploadEncryptor } from '@seedprotocol/encryption'
import { Item } from '@/Item/Item'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { openAllEncryptedDownloads, setEnvelopeDecryptor } from '@/helpers/envelopeContent'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { waitForIdle } from '../test-utils/waitForIdle'
import { waitForPropertyInstances } from '../test-utils/getPublishPayloadIntegrationHelpers'

/**
 * A private Html value synced to another device arrives as an envelope (ADR 0033): the download
 * keeps it in encrypted/<txId>. Without a key the property reads as `valueStatus: 'encrypted'`, not
 * missing; once the app registers a decryptor and opens kept envelopes, it reads the plaintext.
 */
const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.skip
const SCHEMA_NAME = 'Test Schema Encrypted File Value'
const TX = 'EncryptedHtmlTx' + 'x'.repeat(27) + 'A'

testDescribe('a private value downloaded as an envelope', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const schema = {
      $schema: 'https://seedprotocol.io/schemas/data-model/v1',
      version: 1,
      id: generateId(),
      metadata: { name: SCHEMA_NAME, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      models: {
        Diary: {
          id: generateId(),
          properties: {
            title: { id: generateId(), type: 'Text' },
            entry: { id: generateId(), type: 'Html', private: true },
          },
        },
      },
      enums: {},
      migrations: [],
    }
    await importJsonSchema({ contents: JSON.stringify(schema) }, schema.version)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    vi.restoreAllMocks()
    setEnvelopeDecryptor(undefined)
    await teardownTestEnvironment()
  })

  it('reads as encrypted without a key, then as its plaintext once a decryptor opens it', async () => {
    // The Html read tries gateways before the downloaded file; none has this transaction.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('', { status: 404 }))
    const identity = await createEncryptionIdentity()
    // The Html as this device has it after sync: a storage seed pointing at a transaction whose
    // bytes are an envelope, and no plaintext file.
    const diary = await Item.create({ schemaName: SCHEMA_NAME, modelName: 'Diary', title: 'day one' } as any)
    await waitForIdle(diary, 'Item', 15000)
    await waitForPropertyInstances(diary)
    const entry = diary.properties.find((p) => p.propertyName === 'entry')!
    entry.value = '<p>local draft</p>'
    await entry.save()
    const htmlSeedLocalId = entry.propertyValue as string
    const htmlSeed = (await Item.find({ seedLocalId: htmlSeedLocalId, modelName: 'Html' } as any))!
    await waitForPropertyInstances(htmlSeed)
    const storageTransactionId = htmlSeed.properties.find((p) => p.propertyName === 'storageTransactionId')!
    storageTransactionId.value = TX
    await storageTransactionId.save()
    const fs = await import('node:fs')
    await fs.promises.unlink(BaseFileManager.getFilesPath('html', entry.refResolvedValue!))

    const encrypt = createPrivateUploadEncryptor({ recipients: [identity.recipient.publicKey] })
    const { blob } = await encrypt({ blob: new Blob(['<p>dear diary</p>']), contentType: 'text/html' })
    await BaseFileManager.saveFile(BaseFileManager.getFilesPath('encrypted', TX), blob)
    const seedLocalId = diary.seedLocalId
    diary.unload()
    htmlSeed.unload()

    const reloaded = (await Item.find({ seedLocalId, hold: true } as any))!
    await waitForPropertyInstances(reloaded)
    const encrypted = reloaded.properties.find((p) => p.propertyName === 'entry')!
    await encrypted.waitForReady({ timeout: 30000 })
    await vi.waitFor(() => expect(encrypted.valueStatus).toBe('encrypted'), { timeout: 20000 })
    expect(encrypted.value).toBeUndefined()
    expect(encrypted.missingFile).toMatchObject({ encrypted: true, transactionId: TX })

    // A decryptor for someone else opens nothing.
    setEnvelopeDecryptor(createEnvelopeDecryptor([await createEncryptionIdentity()]))
    expect(await openAllEncryptedDownloads()).toEqual({ opened: [], stillEncrypted: [TX] })
    expect(encrypted.valueStatus).toBe('encrypted')

    setEnvelopeDecryptor(createEnvelopeDecryptor([identity]))
    expect(await openAllEncryptedDownloads()).toEqual({ opened: [TX], stillEncrypted: [] })
    expect(await BaseFileManager.readFileAsString(BaseFileManager.getFilesPath('html', `${TX}.html`))).toBe('<p>dear diary</p>')
    await vi.waitFor(() => expect(encrypted.valueStatus).toBe('resolved'), { timeout: 30000 })
    expect(encrypted.value).toBe('<p>dear diary</p>')

    // Opening again writes nothing: the plaintext is there.
    expect(await openAllEncryptedDownloads()).toEqual({ opened: [], stillEncrypted: [] })
    reloaded.unload()
  }, 120000)
})
