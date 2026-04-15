/** Emitted by the client manager after `app_state.addresses` is written (post-`setAddresses`). */
export const ADDRESSES_PERSISTED_EVENT = 'addresses.persisted' as const

export type AddressesPersistedPayload = {
  owned: string[]
  watched: string[]
}

export function parseAddressesPersistedPayload(
  value: unknown,
): AddressesPersistedPayload {
  if (!value || typeof value !== 'object') {
    return { owned: [], watched: [] }
  }
  const v = value as { owned?: unknown; watched?: unknown }
  const owned = Array.isArray(v.owned)
    ? v.owned.filter((a): a is string => typeof a === 'string')
    : []
  const watched = Array.isArray(v.watched)
    ? v.watched.filter((a): a is string => typeof a === 'string')
    : []
  return { owned, watched }
}
