import { describe, expect, mock, test } from 'bun:test'
import { createActor, createMachine } from 'xstate'
import type { PublishUploadData } from '@seedprotocol/sdk'
import type { BlobStore, BlobStoreContext } from './types'

/** A store that records what publish asks of it, and names each upload `mem:<n>`. */
const calls: { prepare: { uploads: PublishUploadData[]; ctx: BlobStoreContext }[]; send: unknown[][] } = {
  prepare: [],
  send: [],
}
const memoryStore: BlobStore = {
  id: 'memory',
  prepare: async (uploads, ctx) => {
    calls.prepare.push({ uploads, ctx })
    return { ids: uploads.map((_, i) => `mem:${i}`), pending: uploads.map((u) => u.itemPropertyName) }
  },
  send: async (pending) => {
    calls.send.push(pending)
  },
  assertStored: async () => {},
}

const configSigner = { address: '0x0000000000000000000000000000000000000001' }
mock.module('~/config', () => ({
  getPublishConfig: () => ({ blobStore: memoryStore, dataItemSigner: configSigner }),
}))

const upload = (name: string) =>
  ({ blob: new Blob([name]), tags: [], itemPropertyName: name, seedLocalId: `s-${name}`, versionLocalId: 'v1' }) as never

describe('a configured blob store', () => {
  test('fixes the ids publish attests, with the config signer when the publish has none', async () => {
    const { prepareUploads } = await import('~/services/publish/actors/createArweaveDataItems')
    const result = await prepareUploads([upload('image'), upload('body')], {})
    expect(result.arweaveTransactions.map((t) => t.transaction.id)).toEqual(['mem:0', 'mem:1'])
    expect(result.publishUploads.map((u) => u.seedLocalId)).toEqual(['s-image', 's-body'])
    expect(result.bundlerUploadNotNeeded).toBe(false)
    expect(calls.prepare.at(-1)?.ctx.dataItemSigner).toBe(configSigner as never)
  })

  test('is sent the pending uploads it prepared', async () => {
    const { uploadViaBundler } = await import('~/services/publish/actors/uploadViaBundler')
    const events: { type: string }[] = []
    const machine = createMachine({
      invoke: { src: uploadViaBundler, input: { context: { signedDataItems: ['image', 'body'] } as never } },
      on: { '*': { actions: ({ event }) => events.push(event) } },
    })
    const actor = createActor(machine).start()
    await new Promise((r) => setTimeout(r, 10))
    actor.stop()
    expect(events[0]?.type).toBe('uploadComplete')
    expect(calls.send.at(-1)).toEqual(['image', 'body'])
  })
})
