import { describe, it, expect } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useCreateState } from '../src/useCreateState'
import { entityStatus, setEntityStatus } from '../../sdk/src/helpers/entity/entityLifecycle'

/**
 * A create hook reports the entity's own load error, for every entity type; only Schema's reached the
 * hook before, the others showed "Failed to create …" (batch 12).
 */
function failedEntity(error: Error) {
  const service = {
    getSnapshot: () => ({ status: 'active', value: 'idle', context: {} }),
    subscribe: () => ({ unsubscribe() {} }),
    send() {},
  }
  const entity = {
    getService: () => service,
    get status() {
      return entityStatus(entity)
    },
  }
  setEntityStatus(entity, 'error', error)
  return entity
}

describe('useCreateState', () => {
  it("reports the entity's load error instead of the generic message", () => {
    const cause = new Error('Model "Post" has no property "summary" to create')
    const { result } = renderHook(() => useCreateState('Failed to create model property'))
    act(() => {
      result.current.run(() => failedEntity(cause))
    })
    expect(result.current.error).toBe(cause)
    expect(result.current.isLoading).toBe(false)
  })
})
