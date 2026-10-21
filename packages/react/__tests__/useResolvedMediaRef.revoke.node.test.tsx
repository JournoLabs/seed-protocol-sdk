/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import React from 'react'

/** resolveMediaRef creates a new blob: URL per call for a local file; the hook must revoke each one. */
const mocks = vi.hoisted(() => {
  let n = 0
  return {
    resolveMediaRef: vi.fn(async () => ({
      status: 'ready' as const,
      href: `blob:test/${++n}`,
      source: 'localBlob' as const,
    })),
  }
})

vi.mock('@seedprotocol/sdk', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@seedprotocol/sdk')
  return { ...actual, resolveMediaRef: mocks.resolveMediaRef }
})

import { useResolvedMediaRef } from '../src/useResolvedMediaRef'

function Probe({ value }: { value: string }) {
  const { href } = useResolvedMediaRef({ value })
  return <span data-testid="href">{href ?? ''}</span>
}

describe('useResolvedMediaRef local blob URLs', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('revokes the blob URL when the value changes and on unmount', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const tx = (c: string) => c.repeat(43)

    const { rerender, unmount } = render(<Probe value={tx('a')} />)
    await waitFor(() => expect(screen.getByTestId('href').textContent).toMatch(/^blob:test\//))
    const first = screen.getByTestId('href').textContent!

    rerender(<Probe value={tx('b')} />)
    await waitFor(() => expect(screen.getByTestId('href').textContent).not.toBe(first))
    await waitFor(() => expect(screen.getByTestId('href').textContent).toMatch(/^blob:test\//))
    const second = screen.getByTestId('href').textContent!
    expect(revoke).toHaveBeenCalledWith(first)

    unmount()
    expect(revoke).toHaveBeenCalledWith(second)
  })
})
