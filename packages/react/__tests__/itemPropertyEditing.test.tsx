import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { fireEvent, render, renderHook, screen, waitFor, act } from '@testing-library/react'
import React from 'react'
import { SeedProvider, useDebouncedItemProperty, useItemProperty } from '@seedprotocol/react'
import {
  client,
  BaseDb,
  metadata,
  importJsonSchema,
  Item,
  ItemPropertySaveValidationError,
  OwnershipError,
  setGetPublisherForNewSeeds,
} from '@seedprotocol/sdk'
import type { SeedConstructorOptions, SchemaFileFormat } from '@seedprotocol/sdk'
import { and, eq } from 'drizzle-orm'
import { SETUP_HOOK_TIMEOUT_MS } from './test-utils/client-init'
import { WAIT_TIMEOUT_MS } from '../../sdk/__tests__/test-utils/timeouts'

/** Editing a property from React: inputs bound to useItemProperty, and useDebouncedItemProperty. */

const SCHEMA_NAME = 'Test Schema Property Editing'
const MINE = '0x' + '5'.repeat(40)
const OTHER = '0x' + '6'.repeat(40)

const schemaFile: SchemaFileFormat = {
  $schema: 'https://seedprotocol.org/schemas/data-model/v1',
  version: 1,
  id: 'test-schema-property-editing',
  metadata: { name: SCHEMA_NAME, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  models: {
    EditNote: {
      id: 'edit-note-model-id',
      properties: {
        title: { id: 'edit-note-title-id', type: 'Text', validation: { maxLength: 255 } },
      },
    },
  },
  enums: {},
  migrations: [],
} as SchemaFileFormat

const wrapper = ({ children }: { children: React.ReactNode }) => <SeedProvider>{children}</SeedProvider>

const createNote = (title: string) =>
  Item.create({ modelName: 'EditNote', schemaName: SCHEMA_NAME, title } as never) as Promise<any>

const storedTitles = async (seedLocalId: string): Promise<(string | null)[]> => {
  const rows = await BaseDb.getAppDb()!
    .select({ value: metadata.propertyValue })
    .from(metadata)
    .where(and(eq(metadata.seedLocalId, seedLocalId), eq(metadata.propertyName, 'title')))
  return rows.map((row: { value: string | null }) => row.value)
}

beforeAll(async () => {
  if (!client.isInitialized()) {
    const config: SeedConstructorOptions = {
      config: { endpoints: { filePaths: '/api/seed/migrations', files: '/app-files' }, filesDir: '.seed' },
    }
    await client.init(config)
  }
  await waitFor(() => expect(client.isInitialized()).toBe(true), { timeout: SETUP_HOOK_TIMEOUT_MS })
  await importJsonSchema({ contents: JSON.stringify(schemaFile) }, schemaFile.version)
}, SETUP_HOOK_TIMEOUT_MS)

afterEach(async () => {
  setGetPublisherForNewSeeds(null)
  await client.setAddresses({ owned: [], watched: [] })
})

function BoundTitleInput({ seedLocalId }: { seedLocalId: string }) {
  const { property } = useItemProperty({ seedLocalId, propertyName: 'title' })
  if (!property) return null
  return (
    <input
      data-testid="title-input"
      value={(property.value as string | undefined) ?? ''}
      onChange={(e) => {
        property.value = e.target.value
      }}
    />
  )
}

describe('an input bound to useItemProperty', () => {
  for (const keyDelayMs of [0, 15]) {
    it(`keeps every keystroke at ${keyDelayMs} ms per key`, async () => {
      const item = await createNote('')
      render(<BoundTitleInput seedLocalId={item.seedLocalId} />, { wrapper })
      const input = (await screen.findByTestId('title-input')) as HTMLInputElement

      const text = 'Sabcehklop quick brown fox'
      for (const ch of text) {
        // What a key press does: the input's current text plus the key.
        fireEvent.change(input, { target: { value: `${input.value}${ch}` } })
        await new Promise((r) => setTimeout(r, keyDelayMs))
      }

      expect(input.value).toBe(text)
      await vi.waitFor(async () => expect(await storedTitles(item.seedLocalId)).toContain(text), {
        timeout: WAIT_TIMEOUT_MS,
      })
      expect(input.value).toBe(text)
    })
  }
})

describe('useDebouncedItemProperty', () => {
  it('saves the typed value after the delay', async () => {
    const item = await createNote('Before typing')
    const { result } = renderHook(
      () => useDebouncedItemProperty({ seedLocalId: item.seedLocalId, propertyName: 'title' }, 20),
      { wrapper },
    )
    await waitFor(() => expect(result.current.property).toBeDefined(), { timeout: WAIT_TIMEOUT_MS })

    act(() => {
      result.current.setValue('Typ')
      result.current.setValue('Typed')
    })
    expect(result.current.property!.value).toBe('Typed')

    await vi.waitFor(async () => expect(await storedTitles(item.seedLocalId)).toEqual(['Typed']), {
      timeout: WAIT_TIMEOUT_MS,
    })
    expect(result.current.error).toBeNull()
  })

  it('rolls back to the value before typing and reports an OwnershipError for an item not owned', async () => {
    // Created while OTHER is owned, then edited while only MINE is: the item is read-only.
    await client.setAddresses({ owned: [OTHER], watched: [] })
    setGetPublisherForNewSeeds(async () => OTHER)
    const item = await createNote('Not mine')
    await client.setAddresses({ owned: [MINE], watched: [] })

    const { result } = renderHook(
      () => useDebouncedItemProperty({ seedLocalId: item.seedLocalId, propertyName: 'title' }, 20),
      { wrapper },
    )
    await waitFor(() => expect(result.current.property).toBeDefined(), { timeout: WAIT_TIMEOUT_MS })

    act(() => {
      result.current.setValue('Over')
      result.current.setValue('Overwritten')
    })
    expect(result.current.property!.value).toBe('Overwritten')

    await waitFor(() => expect(result.current.error).toBeInstanceOf(OwnershipError), { timeout: WAIT_TIMEOUT_MS })
    expect(result.current.property!.value).toBe('Not mine')
    expect(await storedTitles(item.seedLocalId)).toEqual(['Not mine'])
  })

  it('keeps a value that breaks its rule shown, unwritten, with its validation error (ADR 0019)', async () => {
    const item = await createNote('Shown before typing')
    const { result } = renderHook(
      () => useDebouncedItemProperty({ seedLocalId: item.seedLocalId, propertyName: 'title' }, 20),
      { wrapper },
    )
    await waitFor(() => expect(result.current.property).toBeDefined(), { timeout: WAIT_TIMEOUT_MS })

    act(() => {
      result.current.setValue('y'.repeat(299))
      result.current.setValue('y'.repeat(300))
    })

    await waitFor(() => expect(result.current.error).toBeInstanceOf(ItemPropertySaveValidationError), {
      timeout: WAIT_TIMEOUT_MS,
    })
    expect(result.current.property!.value).toBe('y'.repeat(300))
    expect(await storedTitles(item.seedLocalId)).toEqual(['Shown before typing'])

    // The next save clears it.
    act(() => result.current.setValue('Fixed'))
    await waitFor(() => expect(result.current.error).toBeNull(), { timeout: WAIT_TIMEOUT_MS })
  })
})
