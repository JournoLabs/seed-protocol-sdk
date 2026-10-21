import { GraphQLClient } from 'graphql-request'
import { timedEasFetch } from '../easTiming.js'

/**
 * How long one EAS indexer request may take before it is aborted. Without a limit a stalled
 * indexer holds every caller that awaits it (item creates and saves look up schemas) indefinitely.
 * Large sync queries stay well under this.
 */
export const EAS_REQUEST_TIMEOUT_MS = 30_000

type FetchInit = Parameters<typeof fetch>[1]

function withTimeout(init: FetchInit, timeoutMs: number): FetchInit {
  if (typeof AbortSignal === 'undefined' || typeof AbortSignal.timeout !== 'function') return init
  const timeout = AbortSignal.timeout(timeoutMs)
  const callerSignal = init?.signal
  const signal =
    callerSignal && typeof AbortSignal.any === 'function' ? AbortSignal.any([callerSignal, timeout]) : callerSignal ?? timeout
  return { ...init, signal }
}

/** A GraphQL client for the EAS indexer at `url` whose requests abort after `timeoutMs`. */
export function createEasGraphQLClient(url: string, timeoutMs = EAS_REQUEST_TIMEOUT_MS): GraphQLClient {
  return new GraphQLClient(url, {
    // Resolved per call, so a fetch replaced after construction (tests, polyfills) is used.
    fetch: (input: Parameters<typeof fetch>[0], init?: FetchInit) =>
      timedEasFetch(() => fetch(input, withTimeout(init, timeoutMs)), init),
  })
}
