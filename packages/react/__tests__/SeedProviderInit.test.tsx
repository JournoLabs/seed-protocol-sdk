import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { SeedClientGate, SeedProvider, useIsClientReady } from '@seedprotocol/react'
import type { SeedConfig } from '@seedprotocol/sdk'

// No filesDir or endpoints: client.init fills them in.
const config: SeedConfig = {}

function ReadyFlag() {
  const ready = useIsClientReady()
  return <div data-testid="ready">{ready ? 'ready' : 'loading'}</div>
}

describe('SeedProvider config', () => {
  let container: HTMLElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  // Other files in this browser worker init the client with their own config.
  afterAll(async () => {
    const { client } = await import('@seedprotocol/sdk')
    await client.stop()
  })

  it('calls client.init with config and addresses once across re-renders', async () => {
    const sdk = await import('@seedprotocol/sdk')
    const initSpy = vi.spyOn(sdk.client, 'init').mockResolvedValue(undefined as never)

    const { rerender } = render(
      <SeedProvider config={config} addresses={[]}>
        <div />
      </SeedProvider>,
      { container },
    )
    // A new but equal addresses array doesn't start init again.
    rerender(
      <SeedProvider config={config} addresses={[]}>
        <div />
      </SeedProvider>,
    )

    expect(initSpy).toHaveBeenCalledTimes(1)
    expect(initSpy).toHaveBeenCalledWith({ config, addresses: [] })
  })

  it('applies a later addresses change with setAddresses, not another init', async () => {
    const sdk = await import('@seedprotocol/sdk')
    const initSpy = vi.spyOn(sdk.client, 'init').mockResolvedValue(undefined as never)
    const setSpy = vi.spyOn(sdk.client, 'setAddresses').mockResolvedValue(undefined)
    const owned = { owned: ['0x' + 'a'.repeat(40)] }

    const { rerender, unmount } = render(
      <SeedProvider config={config} addresses={[]}>
        <div />
      </SeedProvider>,
      { container },
    )
    rerender(
      <SeedProvider config={config} addresses={owned}>
        <div />
      </SeedProvider>,
    )
    await waitFor(() => expect(setSpy).toHaveBeenCalledWith(owned))
    rerender(
      <SeedProvider config={config} addresses={[]}>
        <div />
      </SeedProvider>,
    )
    await waitFor(() => expect(setSpy).toHaveBeenLastCalledWith([]))
    expect(initSpy).toHaveBeenCalledTimes(1)

    // A remount runs init again, which leaves the stored addresses alone: no setAddresses
    unmount()
    const remounted = document.createElement('div')
    document.body.appendChild(remounted)
    render(
      <SeedProvider config={config} addresses={[]}>
        <div />
      </SeedProvider>,
      { container: remounted },
    )
    await waitFor(() => expect(initSpy).toHaveBeenCalledTimes(2))
    expect(setSpy).toHaveBeenCalledTimes(2)
  })

  it('SeedClientGate applies a later addresses change with setAddresses, not another init', async () => {
    const sdk = await import('@seedprotocol/sdk')
    const initSpy = vi.spyOn(sdk.client, 'init').mockResolvedValue(undefined as never)
    const setSpy = vi.spyOn(sdk.client, 'setAddresses').mockResolvedValue(undefined)
    const owned = { owned: ['0x' + 'b'.repeat(40)] }

    const { rerender } = render(
      <SeedClientGate initConfig={{ config, addresses: [] }}>
        <div />
      </SeedClientGate>,
      { container },
    )
    rerender(
      <SeedClientGate initConfig={{ config, addresses: owned }}>
        <div />
      </SeedClientGate>,
    )

    await waitFor(() => expect(setSpy).toHaveBeenCalledWith(owned))
    expect(initSpy).toHaveBeenCalledTimes(1)
  })

  it('does not start the client without config', async () => {
    const sdk = await import('@seedprotocol/sdk')
    const initSpy = vi.spyOn(sdk.client, 'init').mockResolvedValue(undefined as never)

    render(
      <SeedProvider>
        <div />
      </SeedProvider>,
      { container },
    )

    expect(initSpy).not.toHaveBeenCalled()
  })

  it('passes an init failure to onInitError', async () => {
    const sdk = await import('@seedprotocol/sdk')
    const error = new sdk.DatabaseNotPersistentError('test')
    vi.spyOn(sdk.client, 'init').mockRejectedValueOnce(error)
    const onInitError = vi.fn()

    render(
      <SeedProvider config={config} onInitError={onInitError}>
        <div />
      </SeedProvider>,
      { container },
    )

    await waitFor(() => expect(onInitError).toHaveBeenCalledWith(error))
    expect(onInitError.mock.calls[0][0].code).toBe('DB_NOT_PERSISTENT')
  })

  it('renders children before the client is ready and starts it', async () => {
    render(
      <SeedProvider config={config}>
        <ReadyFlag />
      </SeedProvider>,
      { container },
    )

    expect(screen.getByTestId('ready')).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('ready').textContent).toBe('ready'), { timeout: 60000 })
  })
})
