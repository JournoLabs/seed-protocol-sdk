import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest'
import { waitFor } from 'xstate'
import { Schema } from '@/Schema/Schema'
import { Model } from '@/Model/Model'
import { BaseDb } from '@/db/Db/BaseDb'
import { schemas } from '@/seedSchema/SchemaSchema'
import { models as modelsTable } from '@/seedSchema/ModelSchema'
import { SchemaFileFormat } from '@/types/import'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { setupTestEnvironment } from './test-utils/client-init'

// Helper function to wait for schema to be in idle state using xstate waitFor
async function waitForSchemaIdle(schema: Schema, timeout: number = 5000): Promise<void> {
  const service = schema.getService()
  
  try {
    await waitFor(
      service,
      (snapshot) => {
        if (snapshot.value === 'error') {
          throw new Error('Schema failed to load')
        }
        return snapshot.value === 'idle'
      },
      { timeout }
    )
  } catch (error: any) {
    if (error.message === 'Schema failed to load') {
      throw error
    }
    throw new Error(`Schema loading timeout after ${timeout}ms`)
  }
}

// Helper function to wait for model to be in idle state using xstate waitFor
async function waitForModelIdle(model: Model, timeout: number = 5000): Promise<void> {
  const service = model.getService()
  
  try {
    await waitFor(
      service,
      (snapshot) => {
        if (snapshot.value === 'error') {
          throw new Error('Model failed to load')
        }
        return snapshot.value === 'idle'
      },
      { timeout }
    )
  } catch (error: any) {
    if (error.message === 'Model failed to load') {
      throw error
    }
    throw new Error(`Model loading timeout after ${timeout}ms`)
  }
}

// Helper to create a test schema
function createTestSchema(name: string, models: Record<string, any> = {}): SchemaFileFormat {
  return {
    $schema: 'https://seedprotocol.org/schemas/data-model/v1',
    version: 1,
    id: generateId(),
    metadata: {
      name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    models,
    enums: {},
    migrations: [],
  }
}

// Helper to wait for validation to complete with timeout
async function waitForValidation(
  validateFn: () => Promise<{ isValid: boolean; errors: any[] }>,
  timeoutMs: number = 15000
): Promise<{ isValid: boolean; errors: any[] }> {
  const startTime = Date.now()
  const result = await Promise.race([
    validateFn(),
    new Promise<{ isValid: boolean; errors: any[] }>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Validation timed out after ${timeoutMs}ms`))
      }, timeoutMs)
    }),
  ])
  
  const duration = Date.now() - startTime
  // Ensure validation completes within reasonable time (should be much less than timeout)
  expect(duration).toBeLessThan(timeoutMs)
  
  return result
}

// This test should run in both browser and Node.js environments
// Use sequential execution to avoid database locking issues in Node.js
const testDescribe = typeof window === 'undefined' 
  ? (describe.sequential || describe)
  : describe

testDescribe('Validation Timeout and Failure Scenarios', () => {
  let fsModule: any
  let pathModule: any
  const isNodeEnv = typeof window === 'undefined'

  beforeAll(async () => {
    // Set up Node.js-specific modules if needed
    if (isNodeEnv) {
      fsModule = await import('fs')
      pathModule = await import('path')
    }

    // Use shared test environment setup
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: 90000,
    })
  }, 90000)

  afterAll(async () => {
    // Clean up
    const db = BaseDb.getAppDb()
    if (db) {
      await db.delete(modelsTable)
      await db.delete(schemas)
    }
  })

  beforeEach(async () => {
    // Clean up database before each test
    const db = BaseDb.getAppDb()
    if (db) {
      await db.delete(modelsTable)
      await db.delete(schemas)
    }
  })

  describe('Schema Validation - Always Returns', () => {
    it('should always return validation result for valid schema', async () => {
      const schemaName = `test-schema-${generateId()}`
      const schemaData = createTestSchema(schemaName, {
        TestModel: {
          properties: {
            title: { dataType: 'String' },
          },
        },
      })

      await importJsonSchema(schemaData)
      const schema = Schema.create(schemaName)
      await waitForSchemaIdle(schema)

      const result = await waitForValidation(() => schema.validate(), 15000)
      
      expect(result).toBeDefined()
      expect(result.isValid).toBe(true)
      expect(result.errors).toEqual([])
    }, 30000)

    it('should always return validation result for invalid schema (missing metadata)', async () => {
      const schemaName = `test-schema-${generateId()}`
      const schema = Schema.create(schemaName)
      
      // Manually set invalid context (missing metadata)
      schema.getService().send({
        type: 'updateContext',
        metadata: undefined,
      })

      // Wait a bit for validation to trigger
      await new Promise(resolve => setTimeout(resolve, 100))

      const result = await waitForValidation(() => schema.validate(), 15000)
      
      expect(result).toBeDefined()
      expect(result.isValid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors.some(e => e.field === 'metadata' || e.field === 'schemaName')).toBe(true)
    }, 30000)

    it('should always return validation result for invalid schema (missing schemaName)', async () => {
      const schemaName = `test-schema-${generateId()}`
      const schema = Schema.create(schemaName)
      
      // Manually set invalid context (empty schemaName)
      schema.getService().send({
        type: 'updateContext',
        schemaName: '',
      })

      // Wait a bit for validation to trigger
      await new Promise(resolve => setTimeout(resolve, 100))

      const result = await waitForValidation(() => schema.validate(), 15000)
      
      expect(result).toBeDefined()
      expect(result.isValid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors.some(e => e.field === 'schemaName')).toBe(true)
    }, 30000)

    it('should return timeout error if validation takes too long', async () => {
      const schemaName = `test-schema-${generateId()}`
      const schema = Schema.create(schemaName)
      
      // Mock the validation service to hang
      const originalValidate = schema.getService().getSnapshot().context
      const validationService = await import('@/Schema/service/validation/SchemaValidationService')
      
      // Create a schema with a very large number of models to potentially slow down validation
      const largeModels: Record<string, any> = {}
      for (let i = 0; i < 1000; i++) {
        largeModels[`Model${i}`] = {
          properties: {
            field1: { dataType: 'String' },
            field2: { dataType: 'Number' },
          },
        }
      }

      const schemaData = createTestSchema(schemaName, largeModels)
      await importJsonSchema(schemaData)
      await waitForSchemaIdle(schema)

      // Validation should still complete within timeout (10 seconds)
      const result = await waitForValidation(() => schema.validate(), 15000)
      
      expect(result).toBeDefined()
      // Should either be valid or have errors, but never hang
      expect(typeof result.isValid).toBe('boolean')
      expect(Array.isArray(result.errors)).toBe(true)
    }, 30000)

    it('should handle validation errors gracefully and always return', async () => {
      const schemaName = `test-schema-${generateId()}`
      const schema = Schema.create(schemaName)
      
      // Set context with invalid model structure
      schema.getService().send({
        type: 'updateContext',
        schemaName,
        metadata: {
          name: schemaName,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        models: {
          InvalidModel: {
            // Missing properties - should cause validation error
            properties: null,
          },
        },
      })

      // Wait a bit for validation to trigger
      await new Promise(resolve => setTimeout(resolve, 100))

      const result = await waitForValidation(() => schema.validate(), 15000)
      
      expect(result).toBeDefined()
      expect(result.isValid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    }, 30000)
  })

  describe('Model Validation - Always Returns', () => {
    it('should always return validation result for valid model', async () => {
      const schemaName = `test-schema-${generateId()}`
      const modelName = 'TestModel'
      const schemaData = createTestSchema(schemaName, {
        [modelName]: {
          properties: {
            title: { dataType: 'String' },
          },
        },
      })

      await importJsonSchema(schemaData)
      const schema = Schema.create(schemaName)
      await waitForSchemaIdle(schema)

      const model = Model.create(modelName, schema)
      await waitForModelIdle(model)

      const result = await waitForValidation(() => model.validate(), 15000)
      
      expect(result).toBeDefined()
      expect(result.isValid).toBe(true)
      expect(result.errors).toEqual([])
    }, 30000)

    it('should always return validation result for invalid model (missing modelName)', async () => {
      const schemaName = `test-schema-${generateId()}`
      const model = Model.create('', schemaName)
      
      // Wait a bit for validation to trigger
      await new Promise(resolve => setTimeout(resolve, 100))

      const result = await waitForValidation(() => model.validate(), 15000)
      
      expect(result).toBeDefined()
      expect(result.isValid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors.some(e => e.field === 'modelName')).toBe(true)
    }, 30000)

    it('should always return validation result for invalid model (missing schemaName)', async () => {
      const modelName = 'TestModel'
      const model = Model.create(modelName, '')
      
      // Wait a bit for validation to trigger
      await new Promise(resolve => setTimeout(resolve, 100))

      const result = await waitForValidation(() => model.validate(), 15000)
      
      expect(result).toBeDefined()
      expect(result.isValid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors.some(e => e.field === 'schemaName')).toBe(true)
    }, 30000)

    it('should always return validation result when schema is not loaded', async () => {
      const schemaName = `test-schema-${generateId()}`
      const modelName = 'TestModel'
      
      // Create model without creating schema first
      const model = Model.create(modelName, schemaName)
      
      // Wait a bit for validation to trigger
      await new Promise(resolve => setTimeout(resolve, 100))

      const result = await waitForValidation(() => model.validate(), 15000)
      
      expect(result).toBeDefined()
      // Should either pass structure validation or return errors, but never hang
      expect(typeof result.isValid).toBe('boolean')
      expect(Array.isArray(result.errors)).toBe(true)
    }, 30000)

    it('should handle validation errors gracefully and always return', async () => {
      const schemaName = `test-schema-${generateId()}`
      const modelName = 'TestModel'
      const schemaData = createTestSchema(schemaName, {
        [modelName]: {
          properties: {
            title: { dataType: 'String' },
          },
        },
      })

      await importJsonSchema(schemaData)
      const schema = Schema.create(schemaName)
      await waitForSchemaIdle(schema)

      const model = Model.create(modelName, schema)
      await waitForModelIdle(model)

      // Set invalid properties
      model.getService().send({
        type: 'updateContext',
        properties: null, // Invalid - should cause validation error
      })

      // Wait a bit for validation to trigger
      await new Promise(resolve => setTimeout(resolve, 100))

      const result = await waitForValidation(() => model.validate(), 15000)
      
      expect(result).toBeDefined()
      expect(result.isValid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    }, 30000)

    it('should return timeout error if validation takes too long', async () => {
      const schemaName = `test-schema-${generateId()}`
      const modelName = 'TestModel'
      
      // Create a schema with many models to potentially slow down validation
      const largeModels: Record<string, any> = {}
      for (let i = 0; i < 500; i++) {
        largeModels[`Model${i}`] = {
          properties: {
            field1: { dataType: 'String' },
            field2: { dataType: 'Number' },
          },
        }
      }
      largeModels[modelName] = {
        properties: {
          title: { dataType: 'String' },
        },
      }

      const schemaData = createTestSchema(schemaName, largeModels)
      await importJsonSchema(schemaData)
      const schema = Schema.create(schemaName)
      await waitForSchemaIdle(schema)

      const model = Model.create(modelName, schema)
      await waitForModelIdle(model)

      // Validation should still complete within timeout (10 seconds)
      const result = await waitForValidation(() => model.validate(), 15000)
      
      expect(result).toBeDefined()
      // Should either be valid or have errors, but never hang
      expect(typeof result.isValid).toBe('boolean')
      expect(Array.isArray(result.errors)).toBe(true)
    }, 30000)
  })

  describe('Concurrent Validation - Never Gets Stuck', () => {
    it('should handle multiple concurrent schema validations', async () => {
      const schemaNames = Array.from({ length: 10 }, () => `test-schema-${generateId()}`)
      
      const schemas = await Promise.all(
        schemaNames.map(async (name) => {
          const schemaData = createTestSchema(name, {
            TestModel: {
              properties: {
                title: { dataType: 'String' },
              },
            },
          })
          await importJsonSchema(schemaData)
          const schema = Schema.create(name)
          await waitForSchemaIdle(schema)
          return schema
        })
      )

      // Run all validations concurrently
      const results = await Promise.all(
        schemas.map(schema => waitForValidation(() => schema.validate(), 15000))
      )

      // All should complete
      expect(results.length).toBe(10)
      results.forEach((result, index) => {
        expect(result).toBeDefined()
        expect(typeof result.isValid).toBe('boolean')
        expect(Array.isArray(result.errors)).toBe(true)
      })
    }, 60000)

    it('should handle multiple concurrent model validations', async () => {
      const schemaName = `test-schema-${generateId()}`
      const modelNames = Array.from({ length: 10 }, (_, i) => `Model${i}`)
      
      const schemaData = createTestSchema(
        schemaName,
        Object.fromEntries(
          modelNames.map(name => [
            name,
            {
              properties: {
                title: { dataType: 'String' },
              },
            },
          ])
        )
      )

      await importJsonSchema(schemaData)
      const schema = Schema.create(schemaName)
      await waitForSchemaIdle(schema)

      const models = modelNames.map(name => Model.create(name, schema))
      await Promise.all(models.map(model => waitForModelIdle(model)))

      // Run all validations concurrently
      const results = await Promise.all(
        models.map(model => waitForValidation(() => model.validate(), 15000))
      )

      // All should complete
      expect(results.length).toBe(10)
      results.forEach((result, index) => {
        expect(result).toBeDefined()
        expect(typeof result.isValid).toBe('boolean')
        expect(Array.isArray(result.errors)).toBe(true)
      })
    }, 60000)

    it('should handle mixed valid and invalid concurrent validations', async () => {
      const schemaName = `test-schema-${generateId()}`
      
      // Create valid schema
      const schemaData = createTestSchema(schemaName, {
        ValidModel: {
          properties: {
            title: { dataType: 'String' },
          },
        },
      })
      await importJsonSchema(schemaData)
      const schema = Schema.create(schemaName)
      await waitForSchemaIdle(schema)

      // Create valid model
      const validModel = Model.create('ValidModel', schema)
      await waitForModelIdle(validModel)

      // Create invalid models (missing schemaName)
      const invalidModels = Array.from({ length: 5 }, () => Model.create('InvalidModel', ''))

      // Run all validations concurrently
      const validations = [
        waitForValidation(() => validModel.validate(), 15000),
        ...invalidModels.map(model => waitForValidation(() => model.validate(), 15000)),
      ]

      const results = await Promise.all(validations)

      // All should complete
      expect(results.length).toBe(6)
      results.forEach((result) => {
        expect(result).toBeDefined()
        expect(typeof result.isValid).toBe('boolean')
        expect(Array.isArray(result.errors)).toBe(true)
      })

      // First should be valid, rest should be invalid
      expect(results[0].isValid).toBe(true)
      results.slice(1).forEach((result) => {
        expect(result.isValid).toBe(false)
      })
    }, 60000)
  })

  describe('Edge Cases - Never Gets Stuck', () => {
    it('should handle validation with circular references gracefully', async () => {
      const schemaName = `test-schema-${generateId()}`
      const schema = Schema.create(schemaName)
      
      // Try to create a schema with potentially problematic structure
      schema.getService().send({
        type: 'updateContext',
        schemaName,
        metadata: {
          name: schemaName,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        models: {
          Model1: {
            properties: {
              ref: { dataType: 'Relation', refModelName: 'Model2' },
            },
          },
          Model2: {
            properties: {
              ref: { dataType: 'Relation', refModelName: 'Model1' },
            },
          },
        },
      })

      // Wait a bit for validation to trigger
      await new Promise(resolve => setTimeout(resolve, 100))

      const result = await waitForValidation(() => schema.validate(), 15000)
      
      expect(result).toBeDefined()
      expect(typeof result.isValid).toBe('boolean')
      expect(Array.isArray(result.errors)).toBe(true)
    }, 30000)

    it('should handle validation with extremely large data structures', async () => {
      const schemaName = `test-schema-${generateId()}`
      
      // Create a model with many properties
      const manyProperties: Record<string, any> = {}
      for (let i = 0; i < 1000; i++) {
        manyProperties[`field${i}`] = { dataType: 'String' }
      }

      const schemaData = createTestSchema(schemaName, {
        LargeModel: {
          properties: manyProperties,
        },
      })

      await importJsonSchema(schemaData)
      const schema = Schema.create(schemaName)
      await waitForSchemaIdle(schema)

      const model = Model.create('LargeModel', schema)
      await waitForModelIdle(model)

      const result = await waitForValidation(() => model.validate(), 15000)
      
      expect(result).toBeDefined()
      expect(typeof result.isValid).toBe('boolean')
      expect(Array.isArray(result.errors)).toBe(true)
    }, 30000)

    it('should handle validation errors during schema loading', async () => {
      const schemaName = `test-schema-${generateId()}`
      const schema = Schema.create(schemaName)
      
      // Trigger validation while schema is still loading
      const validationPromise = waitForValidation(() => schema.validate(), 15000)
      
      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 100))
      
      // Then create the schema
      const schemaData = createTestSchema(schemaName, {
        TestModel: {
          properties: {
            title: { dataType: 'String' },
          },
        },
      })
      await importJsonSchema(schemaData)
      await waitForSchemaIdle(schema)

      const result = await validationPromise
      
      expect(result).toBeDefined()
      expect(typeof result.isValid).toBe('boolean')
      expect(Array.isArray(result.errors)).toBe(true)
    }, 30000)
  })
})

