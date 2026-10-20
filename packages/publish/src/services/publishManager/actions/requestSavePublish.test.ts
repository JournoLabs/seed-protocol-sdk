import { describe, expect, test } from 'bun:test'
import { createActor, fromPromise, setup } from 'xstate'
import { ethers } from 'ethers'
import { getPersistableSnapshot } from './requestSavePublish'

/** Same shape as publishMachine: children are invoked with `input: ({ context }) => ({ context })`. */
function startPublishLikeActor(context: Record<string, unknown>) {
  const machine = setup({
    types: { context: {} as Record<string, unknown>, input: {} as Record<string, unknown> },
    actors: { work: fromPromise(() => new Promise<void>(() => {})) },
  }).createMachine({
    context: ({ input }) => input,
    initial: 'creatingArweaveDataItems',
    states: {
      creatingArweaveDataItems: {
        invoke: { src: 'work', input: ({ context }) => ({ context }) },
      },
    },
  })
  return createActor(machine, { input: context }).start()
}

describe('getPersistableSnapshot', () => {
  test('drops dataItemSigner from the context and from child inputs', () => {
    const hd = ethers.Wallet.createRandom()
    const actor = startPublishLikeActor({
      address: '0xabc',
      publishRunId: 'run-1',
      dataItemSigner: hd,
      signedDataItems: [{ id: 'x', raw: new Uint8Array(4) }],
    })

    const raw = JSON.stringify(actor.getPersistedSnapshot())
    // Sanity: without stripping, the key material reaches the JSON (root and child input).
    expect(raw).toContain(hd.mnemonic!.phrase)

    const json = JSON.stringify(getPersistableSnapshot(actor))
    expect(json).not.toContain('dataItemSigner')
    expect(json).not.toContain(hd.mnemonic!.phrase)
    expect(json).not.toContain('signedDataItems')

    const parsed = JSON.parse(json)
    expect(parsed.context.publishRunId).toBe('run-1')
    expect(parsed.context.address).toBe('0xabc')
    expect(parsed.value).toBe('creatingArweaveDataItems')
    actor.stop()
  })
})
