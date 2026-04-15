import { describe, expect, test } from 'bun:test'
import { PublishMachineStates } from './constants'
import { getPublishMachineValueForUi, resolvePublishDisplayValue } from './publishDisplayHelpers'

describe('resolvePublishDisplayValue', () => {
  test('returns undefined for interrupted rows when no live actor', () => {
    const value = resolvePublishDisplayValue(
      null,
      { status: 'interrupted' },
      'creatingAttestations',
    )
    expect(value).toBeUndefined()
  })
})

describe('getPublishMachineValueForUi', () => {
  test('returns undefined for interrupted rows even if completedAt exists', () => {
    const value = getPublishMachineValueForUi({
      status: 'interrupted',
      persistedSnapshot: JSON.stringify({
        status: 'done',
        value: PublishMachineStates.SUCCESS,
      }),
      completedAt: Date.now(),
    })
    expect(value).toBeUndefined()
  })
})
