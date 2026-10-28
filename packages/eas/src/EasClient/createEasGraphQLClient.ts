import { GraphQLClient } from 'graphql-request'
import { timedEasFetch } from '../easTiming.js'

/**
 * How long one EAS indexer request may take before it is aborted. Without a limit a stalled
 * indexer holds every caller that awaits it (item creates and saves look up schemas) indefinitely.
 * Large sync queries stay well under this.
 */
export const EAS_REQUEST_TIMEOUT_MS = 30_000

type FetchInit = Parameters<typeof fetch>[1]

function timeoutError(timeoutMs: number): Error {
  const message = `EAS indexer request timed out after ${timeoutMs} ms`
  return typeof DOMException === 'function'
    ? new DOMException(message, 'TimeoutError')
    : Object.assign(new Error(message), { name: 'TimeoutError' })
}

/**
 * `init` with a signal that aborts after `timeoutMs` or when the caller's signal does, built on an
 * AbortController and a timer so it works where `AbortSignal.any` or `AbortSignal.timeout` don't
 * exist. Call `done` once the request settles to clear the timer.
 */
function withTimeout(init: FetchInit, timeoutMs: number): { init: FetchInit; done: () => void } {
  if (typeof AbortController === 'undefined') return { init, done: () => {} }
  const controller = new AbortController()
  const callerSignal = init?.signal ?? undefined
  const timer = setTimeout(() => controller.abort(timeoutError(timeoutMs)), timeoutMs)
  const onCallerAbort = () => controller.abort(callerSignal?.reason)
  if (callerSignal?.aborted) onCallerAbort()
  else callerSignal?.addEventListener('abort', onCallerAbort, { once: true })
  return {
    init: { ...init, signal: controller.signal },
    done: () => {
      clearTimeout(timer)
      callerSignal?.removeEventListener('abort', onCallerAbort)
    },
  }
}

export type EasGraphQLClientOptions = {
  /**
   * Passed to `fetch` as `dispatcher` on every request (Node's fetch takes an undici
   * `Dispatcher` there; other runtimes ignore it). A promise is awaited before each request is
   * sent. `@seedprotocol/eas/node` sets one.
   */
  dispatcher?: unknown
}

/** A GraphQL client for the EAS indexer at `url` whose requests abort after `timeoutMs`. */
export function createEasGraphQLClient(
  url: string,
  timeoutMs = EAS_REQUEST_TIMEOUT_MS,
  { dispatcher }: EasGraphQLClientOptions = {},
): GraphQLClient {
  return new GraphQLClient(url, {
    // Resolved per call, so a fetch replaced after construction (tests, polyfills) is used.
    fetch: (input: Parameters<typeof fetch>[0], init?: FetchInit) => {
      const { init: timed, done } = withTimeout(init, timeoutMs)
      const send = async () => {
        const resolved: unknown = await dispatcher
        // Aborted (caller or timeout) while the dispatcher was resolving: don't send.
        if (timed?.signal?.aborted) throw timed.signal.reason
        return fetch(input, resolved ? ({ ...timed, dispatcher: resolved } as FetchInit) : timed)
      }
      return timedEasFetch(send, init).finally(done)
    },
  })
}
