/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'

const VALID_TX = 'JYeiPzuglpwr4cMRmCDFFmROnzXwdrDZAzg8vaZZRpY'
const GATEWAY_URL = `https://arweave.net/raw/${VALID_TX}`

const mocks = vi.hoisted(() => ({
  ensureImageLocal: vi.fn(async () => ({
    status: 'ready' as const,
    filePath: `/images/${VALID_TX}`,
    createdWidths: [480],
  })),
  getRawUrl: vi.fn((tx: string) => `https://arweave.net/raw/${tx}`),
  // Default: no preferred gateways resolved, only the configured host.
  getArweaveReadBaseUrls: vi.fn((): string[] => ['https://arweave.net']),
  pathExists: vi.fn(async () => false),
  getContentUrlFromPath: vi.fn(async () => undefined),
  getFilesPath: vi.fn((...parts: string[]) => parts.join('/')),
  getFs: vi.fn(async () => ({
    readdirSync: () => [],
  })),
  normalizeArweaveTxIdForEnsure: (raw: string | null | undefined) => {
    if (raw == null || raw === '') return undefined
    const t = String(raw).trim()
    return /^[a-z0-9_-]{43}$/i.test(t) ? t : undefined
  },
}))

vi.mock('@seedprotocol/sdk', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@seedprotocol/sdk')
  return {
    ...actual,
    ensureImageLocal: mocks.ensureImageLocal,
    normalizeArweaveTxIdForEnsure: mocks.normalizeArweaveTxIdForEnsure,
    getArweaveReadBaseUrls: mocks.getArweaveReadBaseUrls,
    BaseArweaveClient: {
      ...((actual.BaseArweaveClient as object) ?? {}),
      getRawUrl: mocks.getRawUrl,
    },
    BaseFileManager: {
      ...((actual.BaseFileManager as object) ?? {}),
      pathExists: mocks.pathExists,
      getContentUrlFromPath: mocks.getContentUrlFromPath,
      getFilesPath: mocks.getFilesPath,
      getFs: mocks.getFs,
    },
  }
})

vi.mock('../src/itemProperty', () => ({
  useItemProperty: () => ({ property: null }),
}))

import { SeedImage } from '../src/SeedImage'

function makeImageProperty(overrides: Record<string, unknown> = {}) {
  return {
    propertyName: 'featureImage',
    seedLocalId: 'local-1',
    seedUid: 'uid-1',
    refResolvedValue: VALID_TX,
    value: VALID_TX,
    localStoragePath: undefined,
    getService: () => ({
      getSnapshot: () => ({
        context: { storageTransactionId: VALID_TX },
      }),
    }),
    ...overrides,
  } as any
}

describe('SeedImage ensure / progressive gateway', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.pathExists.mockResolvedValue(false)
    mocks.ensureImageLocal.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                status: 'ready',
                filePath: `/images/${VALID_TX}`,
                createdWidths: [480],
              }),
            50,
          )
        }),
    )
  })

  afterEach(() => {
    cleanup()
  })

  it('shows gateway URL while ensuring when local files are missing', async () => {
    render(
      <SeedImage
        imageProperty={makeImageProperty()}
        filename={VALID_TX}
        width={480}
        ensure
        data-testid="seed-img"
      />,
    )

    const img = await screen.findByTestId('seed-img')
    await waitFor(() => {
      expect(img.getAttribute('src')).toBe(GATEWAY_URL)
    })
    expect(mocks.ensureImageLocal).toHaveBeenCalled()
  })

  it('uses the preferred read gateway first and falls back to the next on error', async () => {
    const PREFERRED = 'https://app.example.com/api/seed-gateway'
    mocks.getArweaveReadBaseUrls.mockReturnValue([PREFERRED, 'https://ar-io.net', 'https://arweave.net'])
    mocks.ensureImageLocal.mockImplementation(() => new Promise(() => {})) // stays ensuring
    try {
      render(
        <SeedImage imageProperty={makeImageProperty()} filename={VALID_TX} width={480} ensure data-testid="seed-img" />,
      )
      const img = await screen.findByTestId('seed-img')
      await waitFor(() => expect(img.getAttribute('src')).toBe(`${PREFERRED}/raw/${VALID_TX}`))

      fireEvent.error(img)
      await waitFor(() => expect(img.getAttribute('src')).toBe(`https://ar-io.net/raw/${VALID_TX}`))
      fireEvent.error(img)
      await waitFor(() => expect(img.getAttribute('src')).toBe(GATEWAY_URL))
      // Every gateway failed: the placeholder, not a broken image.
      fireEvent.error(img)
      await waitFor(() => expect(img.getAttribute('src')).toMatch(/^data:image\/gif/))
    } finally {
      mocks.getArweaveReadBaseUrls.mockReturnValue(['https://arweave.net'])
    }
  })

  it('does not call ensureImageLocal when ensure={false}', async () => {
    render(
      <SeedImage
        imageProperty={makeImageProperty()}
        filename={VALID_TX}
        ensure={false}
        data-testid="seed-img"
      />,
    )

    await screen.findByTestId('seed-img')
    await waitFor(() => {
      expect(mocks.ensureImageLocal).not.toHaveBeenCalled()
    })
  })
})
