// bun test preload (packages/publish/bunfig.toml): no network in tests. See networkGuard.ts.
import { afterAll, afterEach } from 'bun:test'
import { assertNoBlockedRequests } from './networkGuard'
import { installNodeNetworkGuard } from './networkGuard.node'

installNodeNetworkGuard()
afterEach(() => assertNoBlockedRequests('during this test'))
afterAll(() => assertNoBlockedRequests('in this file outside a test'))
