import { describe, it, expect, afterEach } from 'vitest'
import { ModelProperty } from '@/ModelProperty/ModelProperty'

// Pending-write tracking is purely in-memory static state on ModelProperty; these tests never touch
// the DB, so they need no client/DB setup. Each test resets the private maps so ids don't leak between tests.
describe('Pending Writes Tracking', () => {
  afterEach(() => {
    ;((ModelProperty as any).pendingWrites as Map<string, unknown>).clear()
  })

  describe('ModelProperty pending writes', () => {
    it('should track pending property writes', () => {
      const propertyFileId = 'test-property-id'
      const modelId = 1

      // Track a pending write
      ModelProperty.trackPendingWrite(propertyFileId, modelId)

      // Get pending property IDs
      const pendingIds = ModelProperty.getPendingPropertyIds(modelId)

      expect(pendingIds).toContain(propertyFileId)
    })

    it('should return empty array for non-existent model', () => {
      const pendingIds = ModelProperty.getPendingPropertyIds(999)

      expect(pendingIds).toHaveLength(0)
    })

    it('should filter out error status writes', () => {
      const propertyFileId1 = 'test-property-id-1'
      const propertyFileId2 = 'test-property-id-2'
      const modelId = 1

      // Track pending writes
      ModelProperty.trackPendingWrite(propertyFileId1, modelId)
      ModelProperty.trackPendingWrite(propertyFileId2, modelId)

      // Manually set one to error status
      const pendingWrites = (ModelProperty as any).pendingWrites as Map<string, any>
      if (pendingWrites) {
        const write = pendingWrites.get(propertyFileId2)
        if (write) {
          write.status = 'error'
        }
      }

      // Get pending property IDs - should exclude error status
      const pendingIds = ModelProperty.getPendingPropertyIds(modelId)

      expect(pendingIds).toContain(propertyFileId1)
      expect(pendingIds).not.toContain(propertyFileId2)
    })
  })
})

