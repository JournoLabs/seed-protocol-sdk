import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { createEncryptionIdentity, createEnvelopeDecryptor, createPrivateUploadEncryptor } from '@seedprotocol/encryption'
import { encodeCompositeUpload } from '@/helpers/compositeUpload'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { openEncryptedDownloads, plaintextDownloadFiles, setEnvelopeDecryptor } from '@/helpers/envelopeContent'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

const TX = 'EnvelopeContentTx' + 'y'.repeat(25) + 'A'
const text = (s: string) => new TextEncoder().encode(s)

describe('plaintextDownloadFiles', () => {
  it('routes by the content type inside the envelope, as plain downloads are laid out', () => {
    expect(plaintextDownloadFiles(TX, 'image/png', text('png'))).toEqual([{ path: `images/${TX}`, bytes: text('png') }])
    expect(plaintextDownloadFiles(TX, 'text/html; charset=utf-8', text('<p/>'))[0]!.path).toBe(`html/${TX}.html`)
    expect(plaintextDownloadFiles(TX, 'application/ld+json', text('{}'))[0]!.path).toBe(`json/${TX}.json`)
    expect(plaintextDownloadFiles(TX, 'application/pdf', text('%PDF'))[0]!.path).toBe(`files/${TX}.pdf`)
    expect(plaintextDownloadFiles(TX, 'application/octet-stream', text('?'))[0]!.path).toBe(`files/${TX}`)
  })

  it("places a composite's children at their ItemStorage paths and refuses paths outside the files root", () => {
    const composite = encodeCompositeUpload([
      { name: 'diary', bytes: text('<p>entry</p>') },
      { name: 'html', bytes: text('<p>legacy</p>') },
      { name: 'stray', bytes: text('?') },
      { name: 'escape', bytes: text('!') },
    ])
    const files = plaintextDownloadFiles(TX, 'application/octet-stream', composite, { diary: 'diaries/day.html', escape: '../outside' })
    expect(files.map((f) => f.path)).toEqual(['diaries/day.html', `html/${TX}.html`])
  })
})

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.skip

testDescribe('openEncryptedDownloads', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
  }, SETUP_HOOK_TIMEOUT_MS)
  afterAll(async () => {
    await teardownTestEnvironment()
  })
  afterEach(() => setEnvelopeDecryptor(undefined))

  it('opens a kept composite once, and never over a newer local edit', async () => {
    const me = await createEncryptionIdentity()
    const composite = encodeCompositeUpload([{ name: 'diary', bytes: text('<p>published</p>') }])
    const { blob } = await createPrivateUploadEncryptor({ recipients: [me.recipient.publicKey] })({ blob: new Blob([composite as BlobPart]), contentType: 'application/octet-stream' })
    await BaseFileManager.saveFile(BaseFileManager.getFilesPath('encrypted', TX), blob)
    const childPaths = { [TX]: { diary: 'diaries/day.html' } }
    const child = BaseFileManager.getFilesPath('diaries/day.html')

    expect(await openEncryptedDownloads([TX], childPaths)).toEqual({ written: [], opened: [], stillEncrypted: [TX] })

    setEnvelopeDecryptor(createEnvelopeDecryptor([me]))
    expect(await openEncryptedDownloads([TX], childPaths)).toEqual({ written: [child], opened: [TX], stillEncrypted: [] })
    expect(await BaseFileManager.readFileAsString(child)).toBe('<p>published</p>')

    await BaseFileManager.saveFile(child, '<p>edited here</p>')
    expect(await openEncryptedDownloads([TX], childPaths)).toEqual({ written: [], opened: [], stillEncrypted: [] })
    expect(await BaseFileManager.readFileAsString(child)).toBe('<p>edited here</p>')
  }, 60000)
})
