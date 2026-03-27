import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { render, waitFor, within } from '@testing-library/react'
import React from 'react'
import { SeedImage, SeedProvider, createSeedQueryClient } from '@seedprotocol/react'
import type { QueryClient } from '@tanstack/react-query'
import {
  client,
  BaseDb,
  schemas,
  metadata,
  seeds,
  versions,
  propertyUids,
  modelUids,
  models as modelsTable,
  modelSchemas,
  properties,
  publishProcesses,
  importJsonSchema,
  Schema,
  Model,
  Item,
  ItemProperty,
  BaseFileManager,
  loadAllSchemasFromDb,
} from '@seedprotocol/sdk'
import type { SeedConstructorOptions, SchemaFileFormat } from '@seedprotocol/sdk'
import { eq, inArray } from 'drizzle-orm'
import { waitFor as xstateWaitFor } from 'xstate'

const testSchemaWithImage: SchemaFileFormat = {
  $schema: 'https://seedprotocol.org/schemas/data-model/v1',
  version: 1,
  id: 'test-schema-seed-image',
  metadata: {
    name: 'Test Schema Seed Image',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  models: {
    Post: {
      id: 'post-model-seed-image-id',
      properties: {
        title: {
          id: 'title-prop-seed-image-id',
          type: 'Text',
        },
        featureImage: {
          id: 'feature-image-prop-seed-image-id',
          type: 'Image',
        },
      },
    },
  },
  enums: {},
  migrations: [],
}

async function waitForItemIdle(item: Item<any>, timeout: number = 5000): Promise<void> {
  const service = item.getService()
  try {
    await xstateWaitFor(
      service,
      (snapshot) => {
        if (snapshot.value === 'error') {
          throw new Error('Item failed to load')
        }
        return snapshot.value === 'idle'
      },
      { timeout }
    )
  } catch (error: any) {
    if (error.message === 'Item failed to load') {
      throw error
    }
    throw new Error(`Item loading timeout after ${timeout}ms`)
  }
}

async function waitForItemPropertyIdle(
  property: ItemProperty<any>,
  timeout: number = 5000
): Promise<void> {
  const service = property.getService()
  try {
    await xstateWaitFor(
      service,
      (snapshot) => {
        if (snapshot.value === 'error') {
          throw new Error('ItemProperty failed to load')
        }
        return snapshot.value === 'idle'
      },
      { timeout }
    )
  } catch (error: any) {
    if (error.message === 'ItemProperty failed to load') {
      throw error
    }
    throw new Error(`ItemProperty loading timeout after ${timeout}ms`)
  }
}

const TEST_SCHEMA_SEED_IMAGE_NAME = 'Test Schema Seed Image'

/** Remove test schema + rows in FK order (delete from schemas alone fails with SQLITE_CONSTRAINT_FOREIGNKEY). */
async function deleteTestSchemaSeedImageRows(): Promise<void> {
  const db = BaseDb.getAppDb()
  if (!db) return

  const schemaRow = await db
    .select()
    .from(schemas)
    .where(eq(schemas.name, TEST_SCHEMA_SEED_IMAGE_NAME))
    .limit(1)
  if (!schemaRow.length || schemaRow[0].id == null) return

  const schemaId = schemaRow[0].id

  const links = await db
    .select({ modelId: modelSchemas.modelId })
    .from(modelSchemas)
    .where(eq(modelSchemas.schemaId, schemaId))

  const mids = links.map((l) => l.modelId).filter((id): id is number => id != null)
  if (mids.length === 0) {
    await db.delete(modelSchemas).where(eq(modelSchemas.schemaId, schemaId))
    await db.delete(schemas).where(eq(schemas.id, schemaId))
    return
  }

  const modelRows = await db
    .select({ name: modelsTable.name })
    .from(modelsTable)
    .where(inArray(modelsTable.id, mids))
  const modelNames = modelRows.map((m) => m.name).filter(Boolean) as string[]

  const seedRows = await db
    .select({ localId: seeds.localId })
    .from(seeds)
    .where(inArray(seeds.type, modelNames))
  const seedLocalIds = seedRows.map((s) => s.localId).filter(Boolean) as string[]

  if (seedLocalIds.length) {
    await db.delete(publishProcesses).where(inArray(publishProcesses.seedLocalId, seedLocalIds))
    await db.delete(metadata).where(inArray(metadata.seedLocalId, seedLocalIds))
    await db.delete(versions).where(inArray(versions.seedLocalId, seedLocalIds))
    await db.delete(seeds).where(inArray(seeds.localId, seedLocalIds))
  }

  const propRows = await db
    .select({ id: properties.id })
    .from(properties)
    .where(inArray(properties.modelId, mids))
  const pids = propRows.map((p) => p.id).filter((id): id is number => id != null)

  if (pids.length) {
    await db.delete(metadata).where(inArray(metadata.propertyId, pids))
    await db.delete(propertyUids).where(inArray(propertyUids.propertyId, pids))
  }

  await db.delete(modelUids).where(inArray(modelUids.modelId, mids))
  await db.update(properties).set({ refModelId: null }).where(inArray(properties.modelId, mids))
  await db.delete(properties).where(inArray(properties.modelId, mids))
  await db.delete(modelSchemas).where(eq(modelSchemas.schemaId, schemaId))
  await db.delete(modelsTable).where(inArray(modelsTable.id, mids))
  await db.delete(schemas).where(eq(schemas.id, schemaId))
}

async function deleteSchemaFileIfExists(
  schemaName: string,
  version: number,
  schemaFileId: string
): Promise<void> {
  try {
    const path = BaseFileManager.getPathModule()
    const workingDir = BaseFileManager.getWorkingDir()
    const sanitizedName = schemaName
      .replace(/[^a-zA-Z0-9\s_-]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/_+/g, '_')
    const filename = `${schemaFileId}_${sanitizedName}_v${version}.json`
    const filePath = path.join(workingDir, filename)
    const exists = await BaseFileManager.pathExists(filePath)
    if (exists) {
      const fs = await BaseFileManager.getFs()
      await fs.promises.unlink(filePath)
    }
  } catch {
    // Ignore
  }
}

const queryClientRef: React.MutableRefObject<QueryClient | null> = { current: null }
const SeedProviderWrapper = ({ children }: { children: React.ReactNode }) => {
  const queryClient = React.useMemo(() => createSeedQueryClient(), [])
  return (
    <SeedProvider queryClient={queryClient} queryClientRef={queryClientRef}>
      {children}
    </SeedProvider>
  )
}

describe('SeedImage integration tests', () => {
  let container: HTMLElement
  let testItem: Item<any> | null = null

  beforeAll(async () => {
    if (!client.isInitialized()) {
      const config: SeedConstructorOptions = {
        config: {
          endpoints: {
            filePaths: '/api/seed/migrations',
            files: '/app-files',
          },
          filesDir: '.seed',
        },
      }
      await client.init(config)
    }

    await waitFor(
      () => client.isInitialized(),
      { timeout: 30000 }
    )
  }, 30000)

  afterAll(async () => {
    await deleteTestSchemaSeedImageRows()
    await deleteSchemaFileIfExists(
      TEST_SCHEMA_SEED_IMAGE_NAME,
      testSchemaWithImage.version,
      testSchemaWithImage.id
    )
    Schema.clearCache()
  })

  beforeEach(async () => {
    queryClientRef.current = null
    container = document.createElement('div')
    container.id = 'root'
    document.body.appendChild(container)

    await deleteTestSchemaSeedImageRows()

    if (testSchemaWithImage.id) {
      await deleteSchemaFileIfExists(
        TEST_SCHEMA_SEED_IMAGE_NAME,
        testSchemaWithImage.version,
        testSchemaWithImage.id
      )
    }

    try {
      await importJsonSchema(
        { contents: JSON.stringify(testSchemaWithImage) },
        testSchemaWithImage.version
      )
    } catch {
      // Schema might already exist
    }

    await waitFor(
      async () => {
        const allSchemas = await loadAllSchemasFromDb()
        return allSchemas.some((s) => s.schema.metadata?.name === TEST_SCHEMA_SEED_IMAGE_NAME)
      },
      { timeout: 15000 }
    )

    await new Promise((resolve) => setTimeout(resolve, 100))

    const model = Model.create('Post', TEST_SCHEMA_SEED_IMAGE_NAME, { waitForReady: false })
    await xstateWaitFor(
      model.getService(),
      (snapshot) => snapshot.value === 'idle',
      { timeout: 5000 }
    )

    testItem = await Item.create({
      modelName: 'Post',
      title: 'Test Post with Image',
    })
    await waitForItemIdle(testItem)

    await new Promise((resolve) => setTimeout(resolve, 2000))
  })

  afterEach(async () => {
    document.body.innerHTML = ''
    Schema.clearCache()
    if (testItem) {
      testItem.unload()
      testItem = null
    }
  })

  it('renders without crashing when given a valid Image property (no image file)', async () => {
    if (!testItem) return

    const featureImageProperty = testItem.properties.find(
      (p) => p.propertyName === 'featureImage' || p.propertyName === 'featureImageId'
    )

    expect(featureImageProperty).toBeTruthy()
    if (!featureImageProperty) return

    expect(() => {
      render(
        <SeedProviderWrapper>
          <SeedImage
            imageProperty={featureImageProperty}
            alt="Feature image"
            width={400}
          />
        </SeedProviderWrapper>,
        { container }
      )
    }).not.toThrow()

    await waitFor(
      () => true,
      { timeout: 3000 }
    )
  })

  it('renders img element when image file exists and width subdir is present', async () => {
    if (!testItem) return

    const TEST_IMAGE_FILENAME = 'test-seed-image.png'
    const MINIMAL_PNG_BASE64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

    await BaseFileManager.createDirIfNotExists(BaseFileManager.getFilesPath('images'))
    const imagePath = BaseFileManager.getFilesPath('images', TEST_IMAGE_FILENAME)
    const binaryString = atob(MINIMAL_PNG_BASE64)
    const binaryArray = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      binaryArray[i] = binaryString.charCodeAt(i)
    }
    await BaseFileManager.saveFile(imagePath, binaryArray.buffer)

    const widthDir = BaseFileManager.getFilesPath('images', '400')
    await BaseFileManager.createDirIfNotExists(widthDir)
    const sizedPath = BaseFileManager.getFilesPath('images', '400', TEST_IMAGE_FILENAME)
    await BaseFileManager.saveFile(sizedPath, binaryArray.buffer)

    const featureImageProperty = testItem.properties.find(
      (p) => p.propertyName === 'featureImage' || p.propertyName === 'featureImageId'
    ) as ItemProperty<any> | undefined

    expect(featureImageProperty).toBeTruthy()
    if (!featureImageProperty) return

    featureImageProperty.value = TEST_IMAGE_FILENAME

    await waitFor(
      () => {
        const prop = testItem!.properties.find(
          (p) => p.propertyName === 'featureImage' || p.propertyName === 'featureImageId'
        ) as ItemProperty<any> | undefined
        return prop?.refResolvedValue === TEST_IMAGE_FILENAME
      },
      { timeout: 20000 }
    )

    render(
      <SeedProviderWrapper>
        <SeedImage
          imageProperty={featureImageProperty}
          alt="Feature image"
          width={400}
          filename={TEST_IMAGE_FILENAME}
        />
      </SeedProviderWrapper>,
      { container }
    )

    const scoped = within(container)
    await waitFor(
      () => {
        const img = scoped.queryByRole('img', { name: /feature image/i })
        return img !== null && (img as HTMLImageElement).src?.length > 0
      },
      { timeout: 15000 }
    )

    const img = scoped.getByRole('img', { name: /feature image/i })
    expect(img).toBeTruthy()
    expect((img as HTMLImageElement).src).toBeTruthy()
  })

  it('renders after reload when image was set via Blob', async () => {
    if (!testItem) return

    const MINIMAL_PNG_BASE64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const binaryString = atob(MINIMAL_PNG_BASE64)
    const binaryArray = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      binaryArray[i] = binaryString.charCodeAt(i)
    }
    const blob = new Blob([binaryArray], { type: 'image/png' })

    const featureImageProperty = testItem.properties.find(
      (p) => p.propertyName === 'featureImage' || p.propertyName === 'featureImageId'
    ) as ItemProperty<any> | undefined

    expect(featureImageProperty).toBeTruthy()
    if (!featureImageProperty) return

    featureImageProperty.value = blob

    await waitFor(
      () => {
        const prop = testItem!.properties.find(
          (p) => p.propertyName === 'featureImage' || p.propertyName === 'featureImageId'
        ) as ItemProperty<any> | undefined
        return !!prop?.refResolvedValue
      },
      { timeout: 20000 }
    )

    const seedLocalId = testItem.seedLocalId
    testItem.unload()

    const reloadedItem = await Item.find({ modelName: 'Post', seedLocalId })
    expect(reloadedItem).toBeTruthy()
    if (!reloadedItem) return
    await waitForItemIdle(reloadedItem)

    const reloadedProp = reloadedItem.properties.find(
      (p) => p.propertyName === 'featureImage' || p.propertyName === 'featureImageId'
    ) as ItemProperty<any> | undefined
    expect(reloadedProp).toBeTruthy()
    if (!reloadedProp) return

    await waitForItemPropertyIdle(reloadedProp)

    render(
      <SeedProviderWrapper>
        <SeedImage imageProperty={reloadedProp} alt="Feature image" width={400} />
      </SeedProviderWrapper>,
      { container }
    )

    const scoped = within(container)
    await waitFor(
      () => {
        const img = scoped.queryByRole('img', { name: /feature image/i })
        const src = (img as HTMLImageElement)?.src
        return img !== null && src?.length > 0 && src.startsWith('blob:')
      },
      { timeout: 15000 }
    )

    const img = scoped.getByRole('img', { name: /feature image/i })
    expect((img as HTMLImageElement).src).toMatch(/^blob:/)
  })

  it('renders after reload when image was set via blob URL', async () => {
    if (!testItem) return

    const MINIMAL_PNG_BASE64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const binaryString = atob(MINIMAL_PNG_BASE64)
    const binaryArray = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      binaryArray[i] = binaryString.charCodeAt(i)
    }
    const blob = new Blob([binaryArray], { type: 'image/png' })
    const blobUrl = URL.createObjectURL(blob)

    const featureImageProperty = testItem.properties.find(
      (p) => p.propertyName === 'featureImage' || p.propertyName === 'featureImageId'
    ) as ItemProperty<any> | undefined

    expect(featureImageProperty).toBeTruthy()
    if (!featureImageProperty) return

    featureImageProperty.value = blobUrl

    await waitFor(
      () => {
        const prop = testItem!.properties.find(
          (p) => p.propertyName === 'featureImage' || p.propertyName === 'featureImageId'
        ) as ItemProperty<any> | undefined
        return !!prop?.refResolvedValue
      },
      { timeout: 20000 }
    )

    URL.revokeObjectURL(blobUrl)
    const seedLocalId = testItem.seedLocalId
    testItem.unload()

    const reloadedItem = await Item.find({ modelName: 'Post', seedLocalId })
    expect(reloadedItem).toBeTruthy()
    if (!reloadedItem) return
    await waitForItemIdle(reloadedItem)

    const reloadedProp = reloadedItem.properties.find(
      (p) => p.propertyName === 'featureImage' || p.propertyName === 'featureImageId'
    ) as ItemProperty<any> | undefined
    expect(reloadedProp).toBeTruthy()
    if (!reloadedProp) return

    await waitForItemPropertyIdle(reloadedProp)

    render(
      <SeedProviderWrapper>
        <SeedImage imageProperty={reloadedProp} alt="Feature image" width={400} />
      </SeedProviderWrapper>,
      { container }
    )

    const scoped = within(container)
    await waitFor(
      () => {
        const img = scoped.queryByRole('img', { name: /feature image/i })
        const src = (img as HTMLImageElement)?.src
        return img !== null && src?.length > 0 && src.startsWith('blob:')
      },
      { timeout: 15000 }
    )

    const img = scoped.getByRole('img', { name: /feature image/i })
    expect((img as HTMLImageElement).src).toMatch(/^blob:/)
  })
})
