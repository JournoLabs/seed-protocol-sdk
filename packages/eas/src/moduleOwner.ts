/**
 * Detects a second copy of this package in one page or process. Each copy has its own
 * BaseEasClient / BaseQueryClient slots and its own chain settings, so code reading through
 * one copy would quietly miss the clients and chain registered on the other.
 *
 * Whichever copy last registered a client records itself under a global key that every copy
 * shares; {@link assertSingleEasModule} throws when that is not the caller's copy.
 */
const OWNER_KEY = Symbol.for('@seedprotocol/eas:clientOwner')

/** Identity of this copy of the module. */
const thisCopy = Object.freeze({ package: '@seedprotocol/eas' })

type GlobalWithOwner = typeof globalThis & { [OWNER_KEY]?: object }

/** @internal Called by BaseEasClient / BaseQueryClient when a client is registered. */
export function markEasClientOwner(): void {
  ;(globalThis as GlobalWithOwner)[OWNER_KEY] = thisCopy
}

export class DuplicateEasModuleError extends Error {
  constructor() {
    super(
      'Two copies of @seedprotocol/eas are loaded, and EAS clients were registered on the other copy ' +
        '(e.g. by SeedClient). Reads through this copy would use different clients and a different chain. ' +
        'Make sure every @seedprotocol/* package is the same version and installed once (`npm ls @seedprotocol/eas`). ' +
        'With Vite, keep @seedprotocol/* packages out of optimizeDeps.exclude so they are pre-bundled together, ' +
        'and dedupe them (seedVitePlugin does) when they are linked into the app.',
    )
    this.name = 'DuplicateEasModuleError'
  }
}

/** Throws {@link DuplicateEasModuleError} when another copy of this package registered EAS clients. */
export function assertSingleEasModule(): void {
  const owner = (globalThis as GlobalWithOwner)[OWNER_KEY]
  if (owner !== undefined && owner !== thisCopy) throw new DuplicateEasModuleError()
}

/** @internal Tests that load fresh module copies (vi.resetModules) clear the shared marker. */
export function resetEasClientOwnerForTests(): void {
  delete (globalThis as GlobalWithOwner)[OWNER_KEY]
}
