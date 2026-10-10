import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import React, { useEffect, useState } from 'react'
import { useItem, useItemProperty, SeedProvider, createSeedQueryClient } from '@seedprotocol/react'
import type { QueryClient } from '@tanstack/react-query'
import {
  client,
  metadata,
  importJsonSchema,
  Schema,
  Model,
  Item,
  ItemProperty,
  loadAllSchemasFromDb,
} from '@seedprotocol/sdk'
import type { SeedConstructorOptions, SchemaFileFormat } from '@seedprotocol/sdk'

import { waitFor as xstateWaitFor } from 'xstate'
import { waitForItemIdle, waitForItemPropertyIdle } from '../../sdk/__tests__/test-utils/waitForIdle'
import { cleanupTestSchemaData } from '../../sdk/__tests__/test-utils/cleanupTestDb'
import { WAIT_TIMEOUT_MS } from '../../sdk/__tests__/test-utils/timeouts'

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
    await cleanupTestSchemaData({ items: true })
    Schema.clearCache()
  })

  beforeEach(async () => {
    queryClientRef.current = null
    container = document.createElement('div')
    container.id = 'root'
    document.body.appendChild(container)

    // Removes every test schema, its items and schema files. (This used to delete every metadata
    // row and every seed of type 'post' whatever its schema, and only the schema row itself.)
    await cleanupTestSchemaData({ items: true })

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
        expect(allSchemas.some((s) => s.schema.metadata?.name === 'Test Schema Html Persistence')).toBe(true)
      },
      { timeout: 15000 }
    )

    const model = Model.create('Post', 'Test Schema Html Persistence', { waitForReady: false })
    await xstateWaitFor(
      model.getService(),
      (snapshot) => snapshot.value === 'idle',
      { timeout: WAIT_TIMEOUT_MS }
    )

    testItem = await Item.create({
      modelName: 'Post',
      schemaName: 'Test Schema Html Persistence',
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
