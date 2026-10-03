import { afterEach, describe, expect, test } from 'bun:test'
import { BaseDb } from '@seedprotocol/sdk'
import { Eip7702ModularAccountPublishError, ManagedAccountPublishError } from '../../../errors'
import {
  errorFieldsFromContext,
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
    expect(payload?.errorCode).toBeNull()
  })

  test('no-ops when there is no in_progress row', async () => {
    const fake = makeFakeDb([])
    ;(BaseDb as unknown as { getAppDb: () => unknown }).getAppDb = () =>
      fake.db as unknown

    await markInProgressPublishInterrupted('seed-2')

    expect(fake.getUpdated()).toBe(false)
  })
})

describe('errorFieldsFromContext', () => {
  test('saves the code from ManagedAccountPublishError', () => {
    const err = new ManagedAccountPublishError('Preflight failed', 'PUBLISH_PREFLIGHT_FAILED', '0xabc')
    const fields = errorFieldsFromContext({ error: err, errorStep: 'creatingAttestations' }, 'in_progress')
    expect(fields.errorCode).toBe('PUBLISH_PREFLIGHT_FAILED')
    expect(fields.errorMessage).toBe('Preflight failed')
    expect(fields.errorStep).toBe('creatingAttestations')
    expect(fields.errorDetails).toContain('Preflight failed')
  })

  test('saves the code from Eip7702ModularAccountPublishError', () => {
    const err = new Eip7702ModularAccountPublishError('Not upgraded', 'EIP7702_MODULAR_NOT_UPGRADED')
    expect(errorFieldsFromContext({ error: err }, 'failed').errorCode).toBe('EIP7702_MODULAR_NOT_UPGRADED')
  })

  test('clears the code for errors without one', () => {
    const fields = errorFieldsFromContext({ error: new Error('boom') }, 'failed')
    expect(fields.errorCode).toBeNull()
    expect(fields.errorMessage).toBe('boom')
  })

  test('keeps the saved message and stack for an error restored from the DB', () => {
    const err = new ManagedAccountPublishError('UserOp reverted', 'USEROP_REVERTED', '0xabc')
    const restored = JSON.parse(JSON.stringify(err)) as unknown
    const fields = errorFieldsFromContext({ error: restored, errorStep: 'creatingAttestations' }, 'in_progress')
    expect(fields.errorCode).toBe('USEROP_REVERTED')
    expect(fields.errorStep).toBe('creatingAttestations')
    expect('errorMessage' in fields).toBe(false)
    expect('errorDetails' in fields).toBe(false)
  })

  test('saves nothing for completed runs', () => {
    const err = new ManagedAccountPublishError('x', 'USEROP_REVERTED')
    expect(errorFieldsFromContext({ error: err }, 'completed')).toEqual({})
  })
})
