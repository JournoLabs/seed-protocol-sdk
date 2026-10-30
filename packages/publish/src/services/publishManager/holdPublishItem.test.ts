import { describe, expect, test } from 'bun:test'
import { createActor, createMachine } from 'xstate'
import { Item } from '@seedprotocol/sdk'
import { holdItemUntilStopped } from './holdPublishItem'

/** createPublish holds the item until its publish actor stops (batch 12). */
function fakeItem(seedLocalId: string) {
  const actor = createActor(createMachine({}))
  actor.start()
  const instance: any = { seedLocalId, getService: () => actor }
  instance.unload = () => Item.cache.release(instance)
  return instance
}

function fakePublish() {
  const actor = createActor(
    createMachine({ initial: 'running', states: { running: { on: { finish: 'success' } }, success: { type: 'final' } } }),
  )
  actor.start()
  return actor
}

describe('holdItemUntilStopped', () => {
  test('holds a cached item until the publish finishes', () => {
    const item = fakeItem('hold-finish')
    Item.cache.add(item, ['hold-finish'], { hold: true })
    try {
      const publish = fakePublish()
      holdItemUntilStopped(item, publish)
      expect(Item.cache.entryOf(item)?.refCount).toBe(2)
      publish.send({ type: 'finish' })
      expect(Item.cache.entryOf(item)?.refCount).toBe(1)
    } finally {
      Item.cache.remove(item)
    }
  })

  test('releases the hold when the publish is stopped', () => {
    const item = fakeItem('hold-stop')
    Item.cache.add(item, ['hold-stop'], { hold: true })
    try {
      const publish = fakePublish()
      holdItemUntilStopped(item, publish)
      publish.stop()
      expect(Item.cache.entryOf(item)?.refCount).toBe(1)
    } finally {
      Item.cache.remove(item)
    }
  })
})
