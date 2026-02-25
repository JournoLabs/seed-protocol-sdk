import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { Model } from '@/Model/Model'
import { ModelProperty } from '@/ModelProperty/ModelProperty'
import { BaseDb } from '@/db/Db/BaseDb'
import { setupTestEnvironment } from '../test-utils/client-init'

describe('Pending Writes Tracking', () => {
  beforeAll(async () => {
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: 30000,
    })
  }, 30000)

  afterEach(async () => {
    // Clean up database after each test
    const db = BaseDb.getAppDb()
    if (db) {
      const { models: modelsTable, properties, schemas: schemasTable } = await import('@/seedSchema')
      await db.delete(properties)
      await db.delete(modelsTable)
      await db.delete(schemasTable)
    }

    // Clear Model and ModelProperty caches
    Model.clearCache?.()
    if (typeof (ModelProperty as any).clearCache === 'function') {
      (ModelProperty as any).clearCache()
    }
  })

  describe('Model pending writes', () => {
    it('should track pending model writes', () => {
      const modelFileId = 'test-model-id'
      const schemaId = 1

      // Track a pending write
      Model.trackPendingWrite(modelFileId, schemaId)

      // Get pending model IDs
      const pendingIds = Model.getPendingModelIds(schemaId)

      expect(pendingIds).toContain(modelFileId)
    })

    it('should return empty array for non-existent schema', () => {
      const pendingIds = Model.getPendingModelIds(999)

      expect(pendingIds).toHaveLength(0)
    })

    it('should filter out error status writes', () => {
      const modelFileId1 = 'test-model-id-1'
      const modelFileId2 = 'test-model-id-2'
      const schemaId = 1

      // Track pending writes
      Model.trackPendingWrite(modelFileId1, schemaId)
      Model.trackPendingWrite(modelFileId2, schemaId)

      // Manually set one to error status (in real scenario, this would be done by write process)
      const pendingWrites = (Model as any).pendingWrites as Map<string, any>
      if (pendingWrites) {
        const write = pendingWrites.get(modelFileId2)
        if (write) {
          write.status = 'error'
        }
      }

      // Get pending model IDs - should exclude error status
      const pendingIds = Model.getPendingModelIds(schemaId)

      expect(pendingIds).toContain(modelFileId1)
      expect(pendingIds).not.toContain(modelFileId2)
    })
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

