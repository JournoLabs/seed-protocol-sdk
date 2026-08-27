export type PlatformTestHandle = {
  restore(): void
}

/**
 * Save/restore helper for swapping a single facade implementation in tests.
 */
export function createFacadeTestHandle<T>(
  getImpl: () => T | null,
  setImpl: (impl: T | null) => void,
  next: T,
): PlatformTestHandle {
  const previous = getImpl()
  setImpl(next)
  return {
    restore() {
      setImpl(previous)
    },
  }
}
