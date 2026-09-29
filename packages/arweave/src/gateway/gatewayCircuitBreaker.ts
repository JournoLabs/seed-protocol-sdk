/**
 * Process-wide circuit breaker for Arweave gateway hosts.
 *
 * After consecutive failures, a host is "open" for a cooldown and skipped by
 * probes / metadata fetches. After the cooldown it becomes half-open (one probe
 * allowed). Success closes the circuit.
 */

export type GatewayCircuitState = 'closed' | 'open' | 'half-open'

type HostCircuit = {
  failures: number
  openedAt: number | null
  /** When half-open, only one probe may run at a time. */
  halfOpenProbeInFlight: boolean
}

const DEFAULT_FAILURE_THRESHOLD = 1
const DEFAULT_OPEN_MS = 60_000

let failureThreshold = DEFAULT_FAILURE_THRESHOLD
let openDurationMs = DEFAULT_OPEN_MS
const circuits = new Map<string, HostCircuit>()

/** Strip scheme / trailing slash; lowercase host (+ optional port/path). */
export function normalizeGatewayHostKey(hostOrUrl: string): string {
  let t = hostOrUrl.trim()
  if (!t) return ''
  if (t.startsWith('http://')) t = t.slice(7)
  else if (t.startsWith('https://')) t = t.slice(8)
  return t.replace(/\/$/, '').toLowerCase()
}

function getOrCreate(key: string): HostCircuit {
  let c = circuits.get(key)
  if (!c) {
    c = { failures: 0, openedAt: null, halfOpenProbeInFlight: false }
    circuits.set(key, c)
  }
  return c
}

function resolveState(c: HostCircuit, now: number): GatewayCircuitState {
  if (c.openedAt == null) return 'closed'
  if (now - c.openedAt >= openDurationMs) return 'half-open'
  return 'open'
}

/**
 * Configure failure threshold and open-state duration (mainly for tests).
 */
export function configureGatewayCircuitBreaker(options: {
  failureThreshold?: number
  openDurationMs?: number
}): void {
  if (options.failureThreshold != null && options.failureThreshold >= 1) {
    failureThreshold = options.failureThreshold
  }
  if (options.openDurationMs != null && options.openDurationMs >= 0) {
    openDurationMs = options.openDurationMs
  }
}

/** Clears all host circuits and restores default thresholds (for tests). */
export function resetGatewayCircuitBreakerForTests(): void {
  circuits.clear()
  failureThreshold = DEFAULT_FAILURE_THRESHOLD
  openDurationMs = DEFAULT_OPEN_MS
}

/**
 * True when the host should not receive new requests (open), or a half-open
 * probe is already in flight.
 */
export function isGatewayHostCircuitOpen(hostOrUrl: string, now = Date.now()): boolean {
  const key = normalizeGatewayHostKey(hostOrUrl)
  if (!key) return false
  const c = circuits.get(key)
  if (!c) return false
  const state = resolveState(c, now)
  if (state === 'open') return true
  if (state === 'half-open' && c.halfOpenProbeInFlight) return true
  return false
}

export function getGatewayHostCircuitState(
  hostOrUrl: string,
  now = Date.now(),
): GatewayCircuitState {
  const key = normalizeGatewayHostKey(hostOrUrl)
  if (!key) return 'closed'
  const c = circuits.get(key)
  if (!c) return 'closed'
  return resolveState(c, now)
}

/**
 * Mark that a probe/request is starting against a half-open host so concurrent
 * callers skip it. No-op when closed or fully open.
 */
export function beginGatewayHostHalfOpenProbe(hostOrUrl: string, now = Date.now()): void {
  const key = normalizeGatewayHostKey(hostOrUrl)
  if (!key) return
  const c = getOrCreate(key)
  if (resolveState(c, now) === 'half-open') {
    c.halfOpenProbeInFlight = true
  }
}

export function recordGatewayHostSuccess(hostOrUrl: string): void {
  const key = normalizeGatewayHostKey(hostOrUrl)
  if (!key) return
  circuits.set(key, { failures: 0, openedAt: null, halfOpenProbeInFlight: false })
}

export function recordGatewayHostFailure(hostOrUrl: string, now = Date.now()): void {
  const key = normalizeGatewayHostKey(hostOrUrl)
  if (!key) return
  const c = getOrCreate(key)
  c.failures += 1
  c.halfOpenProbeInFlight = false
  if (c.failures >= failureThreshold) {
    c.openedAt = now
  }
}

/** Hosts currently in open (or half-open with in-flight) state. */
export function listOpenGatewayCircuitHosts(now = Date.now()): string[] {
  const out: string[] = []
  for (const key of circuits.keys()) {
    if (isGatewayHostCircuitOpen(key, now)) out.push(key)
  }
  return out
}
