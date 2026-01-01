/**
 * Debug script to test schema models loading
 * Run with: npx tsx __tests__/schema/debug-schema-models.ts
 */

import { client } from '@/client'
import { Schema } from '@/Schema/Schema'
import { BaseDb } from '@/db/Db/BaseDb'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { schemas } from '@/seedSchema/SchemaSchema'
import { eq } from 'drizzle-orm'
import internalSchema from '@/seedSchema/SEEDPROTOCOL_Seed_Protocol_v1.json'
import { SchemaFileFormat } from '@/types/import'
import { importJsonSchema } from '@/imports/json'
import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const testProjectPath = path.join(__dirname, '../__mocks__/node/project')

async function debugSchemaModels() {
  console.log('=== Schema Models Debug Script ===\n')

  try {
    // Step 1: Initialize client
    console.log('Step 1: Initializing client...')
    await client.init({
      projectPath: testProjectPath,
    })
    console.log('✓ Client initialized\n')

    // Step 2: Import schema
    console.log('Step 2: Importing seed-protocol schema...')
    const schemaName = 'Seed Protocol'
    const schemaData = internalSchema as SchemaFileFormat
    
    await importJsonSchema({ contents: JSON.stringify(schemaData) }, schemaData.version)
    console.log('✓ Schema imported\n')

    // Step 3: Check database
    console.log('Step 3: Checking database...')
    const db = BaseDb.getAppDb()
    if (!db) {
      throw new Error('Database not found')
    }

    const dbSchemas = await db
      .select()
      .from(schemas)
      .where(eq(schemas.name, schemaName))
      .limit(1)

    if (dbSchemas.length === 0) {
      throw new Error('Schema not found in database')
    }

    const dbSchema = dbSchemas[0]
    console.log('Database schema record:', {
      id: dbSchema.id,
      name: dbSchema.name,
      version: dbSchema.version,
      isDraft: dbSchema.isDraft,
      hasSchemaData: !!dbSchema.schemaData,
      schemaDataLength: dbSchema.schemaData?.length || 0,
      schemaFileId: dbSchema.schemaFileId,
    })

    if (dbSchema.schemaData) {
      const parsed = JSON.parse(dbSchema.schemaData) as SchemaFileFormat
      console.log('Parsed schemaData:', {
        hasModels: !!parsed.models,
        modelCount: parsed.models ? Object.keys(parsed.models).length : 0,
        modelNames: parsed.models ? Object.keys(parsed.models) : [],
      })
    }
    console.log('')

    // Step 4: Create Schema instance
    console.log('Step 4: Creating Schema instance...')
    const schema = Schema.create(schemaName)
    console.log('✓ Schema instance created\n')

    // Step 5: Wait for schema to load
    console.log('Step 5: Waiting for schema to load...')
    await new Promise<void>((resolve, reject) => {
      const subscription = schema.getService().subscribe((snapshot) => {
        console.log(`  Schema state: ${snapshot.value}`)
        if (snapshot.value === 'idle') {
          subscription.unsubscribe()
          resolve()
        } else if (snapshot.value === 'error') {
          subscription.unsubscribe()
          reject(new Error('Schema failed to load'))
        }
      })

      setTimeout(() => {
        subscription.unsubscribe()
        reject(new Error('Schema loading timeout'))
      }, 10000)
    })
    console.log('✓ Schema loaded\n')

    // Step 6: Check context
    console.log('Step 6: Checking schema context...')
    const context = schema.getService().getSnapshot().context
    console.log('Context:', {
      schemaName: context.schemaName,
      version: context.version,
      hasMetadata: !!context.metadata,
      metadataName: context.metadata?.name,
      hasModels: !!context.models,
      modelCount: context.models ? Object.keys(context.models).length : 0,
      modelNames: context.models ? Object.keys(context.models) : [],
    })

    if (context.models) {
      console.log('\nModel details:')
      for (const [modelName, modelData] of Object.entries(context.models)) {
        console.log(`  - ${modelName}:`, {
          hasDescription: !!modelData.description,
          propertyCount: modelData.properties ? Object.keys(modelData.properties).length : 0,
          propertyNames: modelData.properties ? Object.keys(modelData.properties) : [],
        })
      }
    }
    console.log('')

    // Step 7: Check schema.models property
    console.log('Step 7: Checking schema.models property...')
    const models = schema.models
    console.log('schema.models:', {
      isDefined: models !== undefined,
      isNull: models === null,
      isArray: Array.isArray(models),
      length: Array.isArray(models) ? models.length : 'N/A',
      type: typeof models,
    })

    if (Array.isArray(models)) {
      console.log('\nModel instances:')
      for (const model of models) {
        console.log(`  - ${model.modelName}:`, {
          isModelInstance: model.constructor.name === 'Model',
          hasModelName: !!model.modelName,
          hasService: !!model.getService,
        })
      }
    } else {
      console.log('  models value:', models)
    }
    console.log('')

    // Step 8: Check liveQuery integration (replaces _updateModelInstances)
    console.log('Step 8: Checking internal state...')
    // Access private state through reflection (for debugging)
    const instanceState = (schema as any)._instanceState || (Schema as any).schemaInstanceState?.get(schema)
    if (instanceState) {
      console.log('Instance state:', {
        hasLiveQueryModelIds: !!instanceState.liveQueryModelIds,
        liveQueryModelIdCount: instanceState.liveQueryModelIds ? instanceState.liveQueryModelIds.length : 0,
        liveQueryModelIds: instanceState.liveQueryModelIds || [],
      })
    } else {
      console.log('  Could not access instance state')
    }
    console.log('')

    // Summary
    console.log('=== Summary ===')
    console.log(`Context has models: ${!!context.models && Object.keys(context.models).length > 0}`)
    console.log(`schema.models is array: ${Array.isArray(models)}`)
    console.log(`schema.models length: ${Array.isArray(models) ? models.length : 'N/A'}`)
    console.log(`Expected models: Seed, Version, Metadata, Image`)
    console.log(`Actual models: ${Array.isArray(models) ? models.map(m => m.modelName).join(', ') : 'N/A'}`)

  } catch (error) {
    console.error('Error:', error)
    if (error instanceof Error) {
      console.error('Stack:', error.stack)
    }
    process.exit(1)
  }
}

debugSchemaModels()

