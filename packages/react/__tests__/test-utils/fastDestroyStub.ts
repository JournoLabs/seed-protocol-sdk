/**
 * Stand-in entity for destroy-hook tests that need a destroy faster than any service subscription.
 *
 * Real entities run runDestroyLifecycle, which sends destroyStarted and stops the service. When
 * doDestroy has little to do, that happens within a few microtasks, so a hook that watched the
 * service from an effect would miss the whole destroy. This stub's service never reports progress;
 * destroy() still takes a few ms so the test can see the hook's own isLoading.
 */
export function createFastDestroyStub<T>(options: { destroyError?: string } = {}): T {
  const context: { _destroyError: { message: string } | null } = { _destroyError: null }
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
