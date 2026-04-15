/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { QueryClient } from '@tanstack/react-query'
import { SeedProvider } from '../src/SeedProvider'
import { useSeedAddressRevision } from '../src/SeedSessionContext'
import { ADDRESSES_PERSISTED_EVENT } from '../src/addressesPersistedEventName'
import { eventEmitter } from '@seedprotocol/sdk'

function RevisionProbe() {
  const r = useSeedAddressRevision()
  return <div data-testid="address-revision">{String(r)}</div>
}

describe('SeedAddressRevisionProvider (jsdom)', () => {
  beforeEach(() => {
    eventEmitter.removeAllListeners(ADDRESSES_PERSISTED_EVENT)
  })

  afterEach(() => {
    cleanup()
    eventEmitter.removeAllListeners(ADDRESSES_PERSISTED_EVENT)
  })

  it('bumps useSeedAddressRevision when addresses.persisted emits', async () => {
    render(
      <SeedProvider>
        <RevisionProbe />
      </SeedProvider>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('address-revision').textContent).toBe('0')
    })
    eventEmitter.emit(ADDRESSES_PERSISTED_EVENT, { owned: [], watched: [] })
    await waitFor(() => {
      expect(screen.getByTestId('address-revision').textContent).toBe('1')
    })
  })

  it('invalidates seed items queries on addresses.persisted', async () => {
    const queryClient = new QueryClient()
    const inv = vi.spyOn(queryClient, 'invalidateQueries')

    render(
      <SeedProvider queryClient={queryClient}>
        <RevisionProbe />
      </SeedProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('address-revision').textContent).toBe('0')
    })

    eventEmitter.emit(ADDRESSES_PERSISTED_EVENT, { owned: ['0xabc'], watched: [] })

    await waitFor(() => {
      expect(screen.getByTestId('address-revision').textContent).toBe('1')
    })

    expect(inv).toHaveBeenCalledWith({ queryKey: ['seed', 'items'], exact: false })
  })
})
