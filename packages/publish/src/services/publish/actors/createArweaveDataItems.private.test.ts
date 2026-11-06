import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Item, importJsonSchema, generateId } from '@seedprotocol/sdk'
import {
  createPrivateUploadEncryptor,
  decryptEnvelope,
  generateRecipientKeyPair,
  unwrapWithSecretKeys,
} from '@seedprotocol/encryption'
import { setConfigRef } from '~/config'
import { executeCreateArweaveDataItems } from './createArweaveDataItems'
import {
  setupTestEnvironment,
  teardownTestEnvironment,
  SETUP_HOOK_TIMEOUT_MS,
} from '../../../../../sdk/__tests__/test-utils/client-init'
import { waitForPropertyInstances } from '../../../../../sdk/__tests__/test-utils/getPublishPayloadIntegrationHelpers'
import { waitForIdle } from '../../../../../sdk/__tests__/test-utils/waitForIdle'
import type { PublishMachineContext } from '../../../types'

/**
 * A private property's upload leaves the publish actor as an envelope only the publisher's key
 * opens, through the configured encryptor; a public one beside it is uploaded as it is. Real SDK
 * rows and files, the real encryption package; the app's signDataItems stands in for Arweave.
 */
const SCHEMA_NAME = 'Test Schema privatePublishUploads'

describe.sequential('private uploads in a publish', () => {
  const uploaded: { name: string; contentType?: string; tags: { name: string; value: string }[]; bytes: Uint8Array }[] = []
  const signDataItems = async (list: any[]) =>
    Promise.all(
      list.map(async (u, i) => {
        uploaded.push({ name: u.itemPropertyName, contentType: u.contentType, tags: u.tags, bytes: new Uint8Array(await u.blob.arrayBuffer()) })
        return { transaction: { id: `tx-${uploaded.length}-${i}` }, versionId: u.versionLocalId, modelName: u.itemPropertyName }
      }),
    )
  const publisher = generateRecipientKeyPair()

  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const schema = {
      $schema: 'https://seedprotocol.io/schemas/data-model/v1',
      version: 1,
      id: generateId(),
      metadata: { name: SCHEMA_NAME, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      models: {
        Letter: {
          id: generateId(),
          properties: {
            title: { id: generateId(), type: 'Text' },
            body: { id: generateId(), type: 'Html', private: true },
            cover: { id: generateId(), type: 'Html' },
          },
        },
      },
      enums: {},
      migrations: [],
    }
    await importJsonSchema({ contents: JSON.stringify(schema) }, schema.version)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    setConfigRef(null)
    await teardownTestEnvironment()
  })

  it('encrypts the private Html to the publisher and leaves the public one as it is', async () => {
    setConfigRef({
      uploadApiBaseUrl: 'http://127.0.0.1:9',
      arweaveUploadTags: [{ name: 'App-Name', value: 'Letters' }],
      signDataItems,
      encryptPrivateUpload: createPrivateUploadEncryptor({ recipients: [publisher.publicKey], bind: { chainId: '11155420' } }),
    } as never)
    const letter = await Item.create({
      schemaName: SCHEMA_NAME,
      modelName: 'Letter',
      title: 'Dear you',
      body: '<p>for your eyes only</p>',
      cover: '<p>open to all</p>',
    } as any)
    await waitForIdle(letter, 'Item', 15000)
    await waitForPropertyInstances(letter)

    await executeCreateArweaveDataItems({ item: letter, arweaveUploadTags: [{ name: 'App-Name', value: 'Letters' }] } as unknown as PublishMachineContext)

    const body = uploaded.find((u) => u.name === 'body')!
    expect(body.contentType).toBe('application/octet-stream')
    expect(body.tags).toContainEqual({ name: 'Seed-Encryption', value: 'seed-private/v1' })
    expect(body.tags).not.toContainEqual({ name: 'App-Name', value: 'Letters' })
    expect(new TextDecoder().decode(body.bytes)).not.toContain('for your eyes only')
    const opened = await decryptEnvelope(body.bytes, { unwrap: unwrapWithSecretKeys([publisher.secretKey]) })
    expect(opened.contentType).toBe('text/html')
    expect(new TextDecoder().decode(opened.body)).toBe('<p>for your eyes only</p>')
    await expect(decryptEnvelope(body.bytes, { unwrap: unwrapWithSecretKeys([generateRecipientKeyPair().secretKey]) })).rejects.toMatchObject({ code: 'NO_KEY' })

    const cover = uploaded.find((u) => u.name === 'cover')!
    expect(cover.contentType).toBe('text/html')
    expect(cover.tags).toContainEqual({ name: 'App-Name', value: 'Letters' })
    expect(new TextDecoder().decode(cover.bytes)).toBe('<p>open to all</p>')
  }, 90_000)

  it('refuses to upload anything when no encryptor is configured', async () => {
    setConfigRef({ uploadApiBaseUrl: 'http://127.0.0.1:9', signDataItems } as never)
    const letter = await Item.create({ schemaName: SCHEMA_NAME, modelName: 'Letter', title: 'Unsealed', body: '<p>secret</p>', cover: '<p>public</p>' } as any)
    await waitForIdle(letter, 'Item', 15000)
    await waitForPropertyInstances(letter)
    const before = uploaded.length

    await expect(executeCreateArweaveDataItems({ item: letter } as unknown as PublishMachineContext)).rejects.toMatchObject({
      code: 'PRIVATE_UPLOAD_NOT_ENCRYPTED',
      itemPropertyName: 'body',
    })
    expect(uploaded).toHaveLength(before)
  }, 90_000)
})
