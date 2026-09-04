import type { QueryDataSource } from './types.js'

let localSource: QueryDataSource | null = null

/**
 * Register the SDK (or test) local SQLite/files adapter.
 * Replaces any previously registered local source.
 */
export function registerLocalQuerySource(source: QueryDataSource): void {
  if (source.kind !== 'local') {
    throw new Error(
      '[query] registerLocalQuerySource expects a source with kind: "local"',
    )
  }
  localSource = source
}

/** Clear the registered local source (tests / teardown). */
export function clearLocalQuerySource(): void {
  localSource = null
}

export function getRegisteredLocalQuerySource(): QueryDataSource | null {
  return localSource
}

export function hasLocalQuerySource(): boolean {
  return localSource != null
}
