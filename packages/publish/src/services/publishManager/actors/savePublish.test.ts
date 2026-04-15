import { afterEach, describe, expect, test } from 'bun:test'
import { BaseDb } from '@seedprotocol/sdk'
import {
  isTerminalPublishRowStatus,
  markInProgressPublishInterrupted,
} from './savePublish'

type FakeSelectRow = {
  id?: number | null
}

function makeFakeDb(rows: FakeSelectRow[]) {
  let updated = false
  let updateSetPayload: Record<string, unknown> | undefined

  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => rows,
          }),
        }),
      }),
    }),
    update: () => ({
      set: (payload: Record<string, unknown>) => {
        updateSetPayload = payload
        return {
          where: async () => {
            updated = true
          },
        }
      },
    }),
  }

  return {
    db,
    getUpdated: () => updated,
    getSetPayload: () => updateSetPayload,
  }
}

const originalGetAppDb = BaseDb.getAppDb

afterEach(() => {
  ;(BaseDb as unknown as { getAppDb: typeof BaseDb.getAppDb }).getAppDb = originalGetAppDb
})

describe('isTerminalPublishRowStatus', () => {
  test('treats interrupted as terminal', () => {
    expect(isTerminalPublishRowStatus('interrupted')).toBe(true)
    expect(isTerminalPublishRowStatus('completed')).toBe(true)
    expect(isTerminalPublishRowStatus('failed')).toBe(true)
    expect(isTerminalPublishRowStatus('in_progress')).toBe(false)
  })
})

describe('markInProgressPublishInterrupted', () => {
  test('updates latest in_progress row to interrupted', async () => {
    const fake = makeFakeDb([{ id: 123 }])
    ;(BaseDb as unknown as { getAppDb: () => unknown }).getAppDb = () =>
      fake.db as unknown

    await markInProgressPublishInterrupted('seed-1')

    expect(fake.getUpdated()).toBe(true)
    const payload = fake.getSetPayload()
    expect(payload?.status).toBe('interrupted')
    expect(typeof payload?.completedAt).toBe('number')
    expect(typeof payload?.updatedAt).toBe('number')
  })

  test('no-ops when there is no in_progress row', async () => {
    const fake = makeFakeDb([])
    ;(BaseDb as unknown as { getAppDb: () => unknown }).getAppDb = () =>
      fake.db as unknown

    await markInProgressPublishInterrupted('seed-2')

    expect(fake.getUpdated()).toBe(false)
  })
})
