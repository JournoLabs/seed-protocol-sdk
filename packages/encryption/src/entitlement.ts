/**
 * Who may receive keys for an access policy. Adapters answer one question for one policy kind:
 * was `address` entitled at `blockTag`? Licensing, subscriptions and token gates each register
 * their own kind; key grants are issued only to addresses an adapter says yes to.
 */

/** The parts of an access policy an adapter reads. `kind` selects the adapter. */
export interface AccessPolicyRef {
  policyId: string
  kind: string
  /** Adapter-specific configuration fixed when the policy was created (contract address, schema uid...). */
  gateConfig?: unknown
}

/** A block number, or a tag such as 'latest'. Entitlement decisions pin a block so they can be re-run. */
export type EntitlementBlockTag = bigint | 'latest'

export interface EntitlementAdapter {
  isEntitled(policy: AccessPolicyRef, address: string, blockTag: EntitlementBlockTag): Promise<boolean>
}

export class UnknownEntitlementKindError extends Error {
  readonly kind: string
  constructor(kind: string) {
    super(`No entitlement adapter is registered for policy kind "${kind}"`)
    this.name = 'UnknownEntitlementKindError'
    this.kind = kind
  }
}

const adapters = new Map<string, EntitlementAdapter>()

/**
 * Registers the adapter for a policy kind and returns a function that removes it. Registering a
 * kind that already has an adapter throws, so two packages can't silently replace each other.
 */
export function registerEntitlementAdapter(kind: string, adapter: EntitlementAdapter): () => void {
  if (!kind) throw new Error('Entitlement kind must be a non-empty string')
  if (adapters.has(kind)) throw new Error(`An entitlement adapter is already registered for "${kind}"`)
  adapters.set(kind, adapter)
  return () => {
    if (adapters.get(kind) === adapter) adapters.delete(kind)
  }
}

/** Asks the adapter registered for `policy.kind`. Throws UnknownEntitlementKindError when there is none. */
export function isEntitled(policy: AccessPolicyRef, address: string, blockTag: EntitlementBlockTag = 'latest'): Promise<boolean> {
  const adapter = adapters.get(policy.kind)
  if (!adapter) return Promise.reject(new UnknownEntitlementKindError(policy.kind))
  return adapter.isEntitled(policy, address, blockTag)
}
