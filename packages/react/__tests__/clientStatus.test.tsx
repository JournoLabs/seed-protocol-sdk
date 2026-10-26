import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { sql } from 'drizzle-orm'
import {
  SeedClientGate,
  useClientService,
  useDbsAreReady,
  useGlobalServiceStatus,
  useIsClientReady,
  useIsDbReady,
  useLiveQueryState,
  useService,
  useServices,
} from '@seedprotocol/react'
import { BaseDb, client } from '@seedprotocol/sdk'
import type { SeedConstructorOptions } from '@seedprotocol/sdk'
import { SETUP_HOOK_TIMEOUT_MS } from './test-utils/client-init'
import { WAIT_TIMEOUT_MS } from '../../sdk/__tests__/test-utils/timeouts'

const initConfig: SeedConstructorOptions = {
  config: {
    endpoints: {
      filePaths: '/api/seed/migrations',
      files: '/app-files',
    },
    filesDir: '.seed',
  },
  addresses: [],
}

function StatusProbe({ percentLog }: { percentLog?: number[] }) {
  const isClientReady = useIsClientReady()
  const { dbsAreReady } = useDbsAreReady()
  const isDbReady = useIsDbReady()
  const { status, internalStatus } = useGlobalServiceStatus()
  const { services, percentComplete: servicesPercent } = useServices()
  const { percentComplete } = useService(useClientService())
  percentLog?.push(percentComplete)
  return (
    <div>
      <div data-testid="client-ready">{String(isClientReady)}</div>
      <div data-testid="dbs-ready">{String(dbsAreReady)}</div>
      <div data-testid="db-ready">{String(isDbReady)}</div>
      <div data-testid="status">{String(status)}</div>
      <div data-testid="internal-status">{String(internalStatus)}</div>
      <div data-testid="services-current">{String(services[0] === client.getService())}</div>
      <div data-testid="services-percent">{servicesPercent}</div>
      <div data-testid="service-percent">{percentComplete}</div>
    </div>
  )
}

const text = (testId: string) => screen.getByTestId(testId).textContent

describe('client status hooks across stop and init', () => {
  beforeAll(async () => {
    await client.init(initConfig)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    if (client.isInitialized()) await client.stop()
  })

  it('reports percentComplete 100 for an idle client manager', () => {
    render(<StatusProbe />)
    expect(text('service-percent')).toBe('100')
    expect(text('services-percent')).toBe('100')
  })

  it('follows the new client after stop() and init(), with the gate mounted', async () => {
    const percentLog: number[] = []
    render(
      <>
        <StatusProbe percentLog={percentLog} />
        <SeedClientGate
          initConfig={initConfig}
          loadingComponent={<div data-testid="gate-loading">Loading</div>}
        >
          <div data-testid="gated-content">App</div>
        </SeedClientGate>
      </>,
    )
    const gateLoadingShown = () =>
      window.getComputedStyle(screen.getByTestId('gate-loading').parentElement!).display !== 'none'

    await waitFor(() => expect(text('client-ready')).toBe('true'), { timeout: WAIT_TIMEOUT_MS })
    expect(gateLoadingShown()).toBe(false)

    await client.stop()
    await waitFor(() => expect(text('client-ready')).toBe('false'))
    expect(text('dbs-ready')).toBe('false')
    expect(text('db-ready')).toBe('false')
    // A stopped client's last state is idle; the hook mustn't report it as running
    expect(text('status')).toBe('stopped')
    expect(text('internal-status')).toBe('stopped')
    expect(gateLoadingShown()).toBe(true)

    percentLog.length = 0
    await client.init(initConfig)

    await waitFor(() => expect(text('client-ready')).toBe('true'), { timeout: WAIT_TIMEOUT_MS })
    expect(text('dbs-ready')).toBe('true')
    expect(text('db-ready')).toBe('true')
    expect(text('internal-status')).toBe('ready')
    expect(text('services-current')).toBe('true')
    expect(text('services-percent')).toBe('100')
    expect(text('service-percent')).toBe('100')
    expect(gateLoadingShown()).toBe(false)
    // Never -Infinity or out of range while the new client starts.
    for (const percent of percentLog) {
      expect(percent).toBeGreaterThanOrEqual(0)
      expect(percent).toBeLessThanOrEqual(100)
    }
  })

  it('does not call init again when an inline initConfig re-renders with the same values', () => {
    const initSpy = vi.spyOn(client, 'init').mockResolvedValue(undefined as never)
    const schema = { metadata: { name: 'Inline Gate Schema' }, models: {} }

    const { rerender } = render(
      <SeedClientGate initConfig={{ ...initConfig, addresses: [] }} schema={{ ...schema }}>
        <div />
      </SeedClientGate>,
    )
    rerender(
      <SeedClientGate initConfig={{ ...initConfig, addresses: [] }} schema={{ ...schema }}>
        <div />
      </SeedClientGate>,
    )
    expect(initSpy).toHaveBeenCalledTimes(1)

    rerender(
      <SeedClientGate initConfig={{ ...initConfig, addresses: ['0x0000000000000000000000000000000000000001'] }} schema={{ ...schema }}>
        <div />
      </SeedClientGate>,
    )
    expect(initSpy).toHaveBeenCalledTimes(2)
  })
})

// Module level, so the SQL tag function keeps its identity across renders.
const recoveringQuery = (tag: any) => tag`SELECT id FROM live_query_recovery_test`

function LiveQueryProbe() {
  const { data, error } = useLiveQueryState<{ id: number }>(recoveringQuery)
  return (
    <div>
      <div data-testid="lq-data">{data === undefined ? 'none' : JSON.stringify(data)}</div>
      <div data-testid="lq-error">{error ? 'error' : 'none'}</div>
    </div>
  )
}

describe('useLiveQueryState after an error', () => {
  beforeAll(async () => {
    if (!client.isInitialized()) await client.init(initConfig)
    await BaseDb.getAppDb().run(sql`DROP TABLE IF EXISTS live_query_recovery_test`)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    cleanup()
    await BaseDb.getAppDb()?.run(sql`DROP TABLE IF EXISTS live_query_recovery_test`)
  })

  it('reports the error and resubscribes once the query can run', async () => {
    render(<LiveQueryProbe />)

    // The table doesn't exist yet: the error lands in state.error.
    await waitFor(() => expect(text('lq-error')).toBe('error'), { timeout: WAIT_TIMEOUT_MS })
    expect(text('lq-data')).toBe('none')

    await BaseDb.getAppDb().run(sql`CREATE TABLE live_query_recovery_test (id INTEGER PRIMARY KEY)`)
    await BaseDb.getAppDb().run(sql`INSERT INTO live_query_recovery_test (id) VALUES (7)`)

    await waitFor(() => expect(text('lq-data')).toBe('[{"id":7}]'), { timeout: WAIT_TIMEOUT_MS })
    expect(text('lq-error')).toBe('none')
  })
})
