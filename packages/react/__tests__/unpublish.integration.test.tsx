import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React, { useState } from 'react'
import { SeedProvider } from '@seedprotocol/react'
import {
  client,
  BaseDb,
  schemas,
  importJsonSchema,
  Schema,
  setRevokeExecutor,
} from '@seedprotocol/sdk'
import type { SeedConstructorOptions } from '@seedprotocol/sdk'
import { eq } from 'drizzle-orm'
import { waitFor as xstateWaitFor } from 'xstate'
import {
  createGetPublishPayloadTestSchema,
  createPublishedItemForUnpublish,
  UNPUBLISH_TEST_PUBLISHER,
} from '../../sdk/__tests__/test-utils/getPublishPayloadIntegrationHelpers'
import { createTestRevokeExecutor } from '../../sdk/__tests__/test-utils/testRevokeExecutor'
import type { Item as ItemClass } from '@seedprotocol/sdk'

async function waitForItemIdle(item: ItemClass<any>, timeout = 5000): Promise<void> {
  const service = item.getService()
  await xstateWaitFor(
    service,
    (snapshot) => {
      if (snapshot.value === 'error') throw new Error('Item failed to load')
      return snapshot.value === 'idle'
    },
    { timeout }
  )
}

function UnpublishTest({ item }: { item: ItemClass<any> | null }) {
  const [revoked, setRevoked] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleUnpublish = async () => {
    if (!item) return
    setError(null)
    try {
      await item.unpublish()
      setRevoked(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (!item) return <div data-testid="no-item">No item</div>

  return (
    <div data-testid="unpublish-test">
      <div data-testid="item-revoked">{item.isRevoked ? 'revoked' : 'not-revoked'}</div>
      <div data-testid="revoked-state">{revoked ? 'revoked' : 'not-revoked'}</div>
      {error && <div data-testid="unpublish-error">{error}</div>}
      <button
        onClick={handleUnpublish}
        data-testid="unpublish-button"
        disabled={!item.seedUid || item.isRevoked}
      >
        Unpublish
      </button>
    </div>
  )
}

const SeedProviderWrapper = ({ children }: { children: React.ReactNode }) => (
  <SeedProvider>{children}</SeedProvider>
)

describe('Unpublish React Integration Tests', () => {
  let container: HTMLElement
  let publishedItem: ItemClass<any> | null = null

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
        addresses: [UNPUBLISH_TEST_PUBLISHER],
      }
      await client.init(config)
    } else {
      await client.setAddresses([UNPUBLISH_TEST_PUBLISHER])
    }

    await waitFor(() => client.isInitialized(), { timeout: 30000 })
    await createGetPublishPayloadTestSchema()
    setRevokeExecutor(createTestRevokeExecutor())
  }, 60000)

  afterAll(async () => {
    setRevokeExecutor(null)
    const db = BaseDb.getAppDb()
    if (db) {
      await db.delete(schemas).where(eq(schemas.name, 'Test Schema getPublishPayload'))
    }
    Schema.clearCache()
  })

  beforeEach(async () => {
    container = document.createElement('div')
    container.id = 'root'
    document.body.appendChild(container)

    const { item } = await createPublishedItemForUnpublish({ title: 'React unpublish test post' })
    publishedItem = item
    await waitForItemIdle(item)
  })

  afterEach(() => {
    document.body.innerHTML = ''
    publishedItem = null
  })

  it('unpublish button updates UI to show revoked state', async () => {
    render(
      <UnpublishTest item={publishedItem} />,
      { container, wrapper: SeedProviderWrapper }
    )

    expect(screen.getByTestId('item-revoked').textContent).toBe('not-revoked')
    expect(screen.getByTestId('unpublish-button')).not.toBeDisabled()

    screen.getByTestId('unpublish-button').click()

    await waitFor(
      () => {
        expect(screen.getByTestId('item-revoked').textContent).toBe('revoked')
        expect(screen.getByTestId('revoked-state').textContent).toBe('revoked')
      },
      { timeout: 10000 }
    )
  }, 15000)

  it('unpublish button is disabled when item is not published', async () => {
    const { createItemWithBasicPropertiesOnly } = await import(
      '../../sdk/__tests__/test-utils/getPublishPayloadIntegrationHelpers'
    )
    const { item } = await createItemWithBasicPropertiesOnly({ title: 'Never published' })
    await waitForItemIdle(item)

    render(<UnpublishTest item={item} />, { container, wrapper: SeedProviderWrapper })

    expect(screen.getByTestId('unpublish-button')).toBeDisabled()
  }, 15000)
})
