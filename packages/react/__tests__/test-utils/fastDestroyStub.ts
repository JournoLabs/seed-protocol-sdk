/**
 * Stand-in entity for destroy-hook tests that need a destroy the hook can't observe through the service.
 *
 * Real entities run runDestroyLifecycle, which sends destroyStarted and destroyDone and stops the
 * service. When doDestroy has little to do, that all happens before a React effect could subscribe,
 * so the service never shows _destroyInProgress to the hook. This stub's service is in that
 * already-finished state from the start; destroy() still takes a few ms so the test can see the
 * hook's own isLoading.
 */
export function createFastDestroyStub<T>(options: { destroyError?: string } = {}): T {
  const context: { _destroyInProgress: boolean; _destroyError: { message: string } | null } = {
    _destroyInProgress: false,
    _destroyError: null,
  }
  return {
    getService: () => ({
      getSnapshot: () => ({ value: 'idle', context }),
      subscribe: () => ({ unsubscribe: () => {} }),
      send: () => {},
    }),
    destroy: async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
      // Like runDestroyLifecycle, report DB failures via the service context instead of throwing
      if (options.destroyError) context._destroyError = { message: options.destroyError }
    },
  } as unknown as T
}
