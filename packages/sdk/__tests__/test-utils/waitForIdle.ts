import { waitFor, type AnyActorRef } from 'xstate'

// Imports only xstate, not SDK source, so packages/react tests (which use the built SDK) can share it.

export type HasService = { getService(): AnyActorRef }

/**
 * Waits for an entity's service (Schema, Model, Item, ItemProperty, ModelProperty) to reach `idle`,
 * and rejects if it lands in `error` first.
 *
 * The predicate must not throw: xstate's waitFor doesn't catch predicate errors, so a throw there
 * escapes as an uncaught exception on every later snapshot instead of failing the wait.
 */
export async function waitForIdle(entity: HasService, label: string, timeout = 5000): Promise<void> {
  const service = entity.getService()
  let snapshot
  try {
    snapshot = await waitFor(service, (s) => s.value === 'idle' || s.value === 'error', { timeout })
  } catch (error) {
    // A timeout, or the actor stopped before reaching idle
    throw new Error(
      `${label} did not reach idle within ${timeout}ms (state: ${JSON.stringify(service.getSnapshot().value)}): ` +
        (error instanceof Error ? error.message : String(error)),
    )
  }
  if (snapshot.value === 'error') {
    // Only the schema machine records why it failed
    const loadingError = (snapshot.context as { _loadingError?: { stage: string; error: unknown } } | undefined)
      ?._loadingError
    const cause = loadingError?.error instanceof Error ? loadingError.error.message : String(loadingError?.error)
    throw new Error(`${label} failed to load` + (loadingError ? ` at stage ${loadingError.stage}: ${cause}` : ''))
  }
}

export const waitForSchemaIdle = (schema: HasService, timeout?: number) => waitForIdle(schema, 'Schema', timeout)
export const waitForModelIdle = (model: HasService, timeout?: number) => waitForIdle(model, 'Model', timeout)
export const waitForItemIdle = (item: HasService, timeout?: number) => waitForIdle(item, 'Item', timeout)
export const waitForItemPropertyIdle = (property: HasService, timeout?: number) =>
  waitForIdle(property, 'ItemProperty', timeout)
export const waitForModelPropertyIdle = (property: HasService, timeout?: number) =>
  waitForIdle(property, 'ModelProperty', timeout)
