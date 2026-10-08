import { describe, expect, mock, test } from 'bun:test'
import { createActor, createMachine } from 'xstate'
import {
  RelatedItemUnpublishedError,
  type UnpublishedRelatedItem,
} from '../../../../../sdk/src/db/read/publishErrors'

/**
 * Publishing an item that references an unpublished (revoked) item fails in the checking step,
 * before EAS schemas are registered or anything is uploaded or attested.
 */
const harness = {
  unpublished: [] as UnpublishedRelatedItem[],
}
const ensureEasSchemasForItem = mock(async () => {})
const validateItemForPublish = mock(async () => ({ isValid: true, errors: [] }))

mock.module('@seedprotocol/sdk', () => ({
  assertLocalDbChain: async () => {},
  isItemOwned: async () => true,
  validateItemForPublish,
  getUnpublishedRelatedItems: async () => harness.unpublished,
  RelatedItemUnpublishedError,
}))
mock.module('~/helpers/chainClient', () => ({ isContractDeployed: async () => true }))
mock.module('../helpers/itemNeedsArweave', () => ({ itemNeedsArweaveUpload: async () => false }))
mock.module('../helpers/ensureEasSchemas', () => ({ ensureEasSchemasForItem }))
mock.module('~/config', () => ({ getPublishConfig: () => ({ useModularExecutor: true }) }))
mock.module('../../../helpers/chainConfig', () => ({ getPublishChainName: () => 'test chain' }))
mock.module('../../../helpers/verifyPublishChain', () => ({ verifyPublishChain: async () => {} }))

const runChecking = async (seedLocalId: string) => {
  const { checking } = await import('./checking')
  const events: { type: string; errors?: { field?: string; message: string; code?: string }[] }[] = []
  const machine = createMachine({
    invoke: {
      src: checking,
      input: {
        context: {
          item: { seedLocalId },
          wallet: {},
          address: '0x' + '1'.repeat(40),
          publishMode: 'patch',
        },
      },
    },
    on: { '*': { actions: ({ event }) => events.push(event as any) } },
  })
  const actor = createActor(machine).start()
  for (let i = 0; i < 100 && events.length === 0; i++) await new Promise((r) => setTimeout(r, 10))
  actor.stop()
  return events
}

describe('checking: references to unpublished items', () => {
  test('fails validation, naming the items, before registering schemas', async () => {
    harness.unpublished = [
      { propertyName: 'author', modelName: 'Author', seedLocalId: 'authorLocal1', seedUid: '0x' + 'a'.repeat(64) },
    ]
    ensureEasSchemasForItem.mockClear()
    const events = await runChecking('postLocal01')
    expect(events.map((e) => e.type)).toEqual(['validationFailed'])
    expect(events[0]!.errors).toEqual([
      expect.objectContaining({ field: 'author', code: 'related_item_unpublished' }),
    ])
    expect(events[0]!.errors![0]!.message).toContain('authorLocal1')
    expect(ensureEasSchemasForItem).not.toHaveBeenCalled()
  })

  test('goes ahead when nothing referenced is unpublished', async () => {
    harness.unpublished = []
    ensureEasSchemasForItem.mockClear()
    const events = await runChecking('postLocal02')
    expect(events.map((e) => e.type)).toEqual(['skipArweave'])
    expect(ensureEasSchemasForItem).toHaveBeenCalled()
  })
})
