import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  beginGatewayHostHalfOpenProbe,
  configureGatewayCircuitBreaker,
  getGatewayHostCircuitState,
  isGatewayHostCircuitOpen,
  normalizeGatewayHostKey,
  recordGatewayHostFailure,
  recordGatewayHostSuccess,
  resetGatewayCircuitBreakerForTests,
} from '../../src/gateway/gatewayCircuitBreaker.js'

describe('gatewayCircuitBreaker', () => {
  beforeEach(() => {
    resetGatewayCircuitBreakerForTests()
    configureGatewayCircuitBreaker({ failureThreshold: 1, openDurationMs: 60_000 })
  })

  afterEach(() => {
    resetGatewayCircuitBreakerForTests()
  })

  it('normalizeGatewayHostKey strips scheme and trailing slash', () => {
    expect(normalizeGatewayHostKey('https://ar.seedprotocol.io/')).toBe('ar.seedprotocol.io')
    expect(normalizeGatewayHostKey('arweave.net')).toBe('arweave.net')
  })

  it('opens circuit after failure threshold and skips host', () => {
    expect(isGatewayHostCircuitOpen('ar.seedprotocol.io')).toBe(false)
    recordGatewayHostFailure('ar.seedprotocol.io')
    expect(isGatewayHostCircuitOpen('ar.seedprotocol.io')).toBe(true)
    expect(getGatewayHostCircuitState('ar.seedprotocol.io')).toBe('open')
  })

  it('closes circuit on success', () => {
    recordGatewayHostFailure('arweave.net')
    expect(isGatewayHostCircuitOpen('arweave.net')).toBe(true)
    recordGatewayHostSuccess('arweave.net')
    expect(isGatewayHostCircuitOpen('arweave.net')).toBe(false)
    expect(getGatewayHostCircuitState('arweave.net')).toBe('closed')
  })

  it('becomes half-open after cooldown and allows one probe', () => {
    configureGatewayCircuitBreaker({ openDurationMs: 10 })
    const t0 = 1_000_000
    recordGatewayHostFailure('g8way.io', t0)
    expect(isGatewayHostCircuitOpen('g8way.io', t0 + 1)).toBe(true)
    expect(getGatewayHostCircuitState('g8way.io', t0 + 20)).toBe('half-open')
    expect(isGatewayHostCircuitOpen('g8way.io', t0 + 20)).toBe(false)

    beginGatewayHostHalfOpenProbe('g8way.io', t0 + 20)
    expect(isGatewayHostCircuitOpen('g8way.io', t0 + 20)).toBe(true)
  })
})
