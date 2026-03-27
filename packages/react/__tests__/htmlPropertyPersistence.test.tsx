import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import React, { useEffect, useState } from 'react'
import { useItem, useItemProperty, SeedProvider, createSeedQueryClient } from '@seedprotocol/react'
import type { QueryClient } from '@tanstack/react-query'
import {
  client,
  BaseDb,
  schemas,
  metadata,
  seeds,
  importJsonSchema,
  Schema,
  Model,
  Item,
  ItemProperty,
  BaseFileManager,
  loadAllSchemasFromDb,
} from '@seedprotocol/sdk'
import type { SeedConstructorOptions, SchemaFileFormat } from '@seedprotocol/sdk'
import { eq } from 'drizzle-orm'
import { waitFor as xstateWaitFor } from 'xstate'

const testSchemaHtmlPersistence: SchemaFileFormat = {
  $schema: 'https://seedprotocol.org/schemas/data-model/v1',
  version: 1,
  id: 'test-schema-html-persistence',
  metadata: {
    name: 'Test Schema Html Persistence',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  models: {
    Post: {
      id: 'post-model-html-persistence-id',
      properties: {
        title: {
          id: 'title-prop-html-persistence-id',
          type: 'Text',
        },
        html: {
          id: 'html-prop-html-persistence-id',
          type: 'Html',
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

function HtmlValueDisplayTest({ seedLocalId }: { seedLocalId: string }) {
  const { property, isLoading } = useItemProperty({ seedLocalId, propertyName: 'html' })
  const value = property?.value ?? ''
  return (
    <div data-testid="html-value-display">
      <div data-testid="html-value">{String(value)}</div>
      <div data-testid="is-loading">{isLoading ? 'true' : 'false'}</div>
    </div>
  )
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

describe('Html property persistence integration tests', () => {
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
  })

  afterAll(async () => {
    const deleteSchemaFileIfExists = async (
      schemaName: string,
      version: number,
      schemaFileId: string
    ) => {
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

    const db = BaseDb.getAppDb()
    if (db && testItem) {
      await db.delete(metadata).where(eq(metadata.seedLocalId, testItem.seedLocalId))
      await db.delete(seeds).where(eq(seeds.localId, testItem.seedLocalId))
    }
    if (db) {
      try {
        await db.delete(schemas).where(eq(schemas.name, 'Test Schema Html Persistence'))
      } catch {
        // Browser DB may still have FK references to this schema row.
      }
    }
    await deleteSchemaFileIfExists(
      'Test Schema Html Persistence',
      testSchemaHtmlPersistence.version,
      testSchemaHtmlPersistence.id
    )
    Schema.clearCache()
  })

  beforeEach(async () => {
    queryClientRef.current = null
    container = document.createElement('div')
    container.id = 'root'
    document.body.appendChild(container)

    const db = BaseDb.getAppDb()
    if (db) {
      await db.delete(metadata)
      await db.delete(seeds).where(eq(seeds.type, 'post'))
      await db.delete(schemas).where(eq(schemas.name, 'Test Schema Html Persistence'))
    }

    try {
      await importJsonSchema(
        { contents: JSON.stringify(testSchemaHtmlPersistence) },
        testSchemaHtmlPersistence.version
      )
    } catch {
      // Schema might already exist
    }

    await waitFor(
      async () => {
        const allSchemas = await loadAllSchemasFromDb()
        return allSchemas.some((s) => s.schema.metadata?.name === 'Test Schema Html Persistence')
      },
      { timeout: 15000 }
    )

    await new Promise((resolve) => setTimeout(resolve, 100))

    const model = Model.create('Post', 'Test Schema Html Persistence', { waitForReady: false })
    await xstateWaitFor(
      model.getService(),
      (snapshot) => snapshot.value === 'idle',
      { timeout: 5000 }
    )

    testItem = await Item.create({
      modelName: 'Post',
      title: 'Test Post',
      html: '<h1>Test HTML</h1>',
    })
    await waitForItemIdle(testItem)

    const htmlProperty = testItem.properties.find(
      (p) => p.propertyName === 'html' || p.propertyName === 'htmlId'
    )
    if (htmlProperty) {
      await waitForItemPropertyIdle(htmlProperty)
    }

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

  it('Html property set in React app renders correct value after simulated reload', async () => {
    if (!testItem) return

    const seedLocalId = testItem.seedLocalId
    expect(seedLocalId).toBeDefined()

    ItemProperty.clearInstanceCacheForItem(seedLocalId!)
    testItem.unload()

    render(
      <SeedProviderWrapper>
        <HtmlValueDisplayTest seedLocalId={seedLocalId!} />
      </SeedProviderWrapper>,
      { container }
    )

    const scoped = within(container)
    // Initial render has isLoading false before the fetch effect runs; retry with expect until stable.
    await waitFor(
      () => {
        expect(scoped.queryByTestId('is-loading')?.textContent).toBe('false')
        expect(scoped.getByTestId('html-value').textContent).toContain('<h1>Test HTML</h1>')
      },
      { timeout: 15000 }
    )

    const htmlValueEl = scoped.getByTestId('html-value')
    expect(htmlValueEl.textContent).not.toMatch(/^[a-zA-Z0-9_-]{10,66}$/)
  })
})
