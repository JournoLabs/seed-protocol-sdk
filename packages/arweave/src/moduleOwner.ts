/**
 * Detects a second copy of this package in one page or process. Each copy has its own
 * BaseArweaveClient slot and gateway state, so code reading through one copy would quietly
 * miss the client and gateway registered on the other.
 *
 * Whichever copy last registered a client records itself under a global key that every copy
 * shares; {@link assertSingleArweaveModule} throws when that is not the caller's copy.
 */
const OWNER_KEY = Symbol.for('@seedprotocol/arweave:clientOwner')

/** Identity of this copy of the module. */
const thisCopy = Object.freeze({ package: '@seedprotocol/arweave' })

type GlobalWithOwner = typeof globalThis & { [OWNER_KEY]?: object }

/** @internal Called by BaseArweaveClient when a client is registered. */
export function markArweaveClientOwner(): void {
  ;(globalThis as GlobalWithOwner)[OWNER_KEY] = thisCopy
}

export class DuplicateArweaveModuleError extends Error {
  constructor() {
    super(
      'Two copies of @seedprotocol/arweave are loaded, and the Arweave client was registered on the other copy ' +
        '(e.g. by SeedClient). Reads through this copy would use a different client and gateway. ' +
        'Make sure every @seedprotocol/* package is the same version and installed once (`npm ls @seedprotocol/arweave`). ' +
        'With Vite, use seedVitePlugin (or list @seedprotocol/arweave and @seedprotocol/query in optimizeDeps.include ' +
        'and resolve.dedupe) so they are pre-bundled together.',
    )
    this.name = 'DuplicateArweaveModuleError'
  }
}

/** Throws {@link DuplicateArweaveModuleError} when another copy of this package registered the Arweave client. */
export function assertSingleArweaveModule(): void {
  const owner = (globalThis as GlobalWithOwner)[OWNER_KEY]
  if (owner !== undefined && owner !== thisCopy) throw new DuplicateArweaveModuleError()
}

/** @internal Tests that load fresh module copies (vi.resetModules) clear the shared marker. */
export function resetArweaveClientOwnerForTests(): void {
  delete (globalThis as GlobalWithOwner)[OWNER_KEY]
}
