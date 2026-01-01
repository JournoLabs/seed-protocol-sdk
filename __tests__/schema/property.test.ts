import { Text, Number, Json, Relation, List, TModelClass, IModelClass } from '../../src/schema'
import { Model } from '../../src/Model/Model'
import { Value }                            from '@sinclair/typebox/value'
import { describe, it, beforeAll } from 'vitest'
import path                                                                    from 'path'
import process                                                                 from 'node:process'

// Users/admin/Documents/Work/JournoLabs/seed-protocol-sdk/__tests__/__mocks__/project/.seed/seed.config.ts

describe('Model decorator with properties', () => {
  const projectRoot = path.resolve(process.cwd(),)
  // Note: These are now Model instances, not ModelClassType
  // ModelClassType is now just an alias for Model
  let Post: Model | undefined
  let Identity: Model | undefined
  let Link: Model | undefined

  beforeAll(async () => {
    const schemaFilePath = path.resolve(projectRoot, '__tests__', '__mocks__', 'node', 'project', 'seed.config.ts')
    const { models } = await import(schemaFilePath)
    Post = models.Post
    Identity = models.Identity
    Link = models.Link
  })

  it('should create a valid Model instance from decorated class', ({expect}) => {
    // Check if Post is a Model instance
    expect(Post).toBeDefined()
    expect((Post as any).schema).toBeDefined()
    
    // Note: originalConstructor is no longer part of Model - models are accessed via Model static methods
    // The decorator pattern may still create classes with originalConstructor for backward compatibility
    
    // Validate that it has the Model interface
    const model = Post as Model
    expect(typeof model.create).toBe('function')
    expect(model.schema).toBeDefined()
  })

  it('should have correct property metadata in schema', ({expect}) => {
    const schema = (Post as any).schema

    // Check that all decorated properties exist in the schema
    expect(schema.title).toBeDefined()
    expect(schema.summary).toBeDefined()
    expect(schema.featureImage).toBeDefined()
    expect(schema.html).toBeDefined()
    expect(schema.json).toBeDefined()
    expect(schema.storageTransactionId).toBeDefined()
    expect(schema.authors).toBeDefined()
    expect(schema.importUrl).toBeDefined()

    // Check specific property types
    expect(schema.title.dataType).toBe('Text')
    expect(schema.summary.dataType).toBe('Text')
    expect(schema.featureImage.dataType).toBe('Image')
    expect(schema.html.dataType).toBe('Text')
    expect(schema.json.dataType).toBe('Text')
    expect(schema.storageTransactionId.dataType).toBe('Text')
    expect(schema.authors.dataType).toBe('List')

  })


  it('should validate against TModelClass TypeBox schema', ({expect}) => {
    // Check if the decorated class matches the TModelClass TypeBox schema
    const isPostValid = Value.Check(TModelClass, Post)
    expect(isPostValid).toBe(true)

    const isIdentityValid = Value.Check(TModelClass, Identity)
    expect(isIdentityValid).toBe(true)

    const isLinkValid = Value.Check(TModelClass, Link)
    expect(isLinkValid).toBe(true)
  })

  it('should be able to instantiate the model', ({expect}) => {
    // Test that we can instantiate the model
    const instance = new Post()
    expect(instance).toBeDefined()
    expect(instance.name).toBe('')
    expect(instance.age).toBe(0)
    expect(instance.metadata).toEqual({})
    expect(instance.relatedItem).toBeNull()
    expect(instance.items).toEqual([])
  })
})
