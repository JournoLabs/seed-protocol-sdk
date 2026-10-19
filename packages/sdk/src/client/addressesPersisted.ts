import { ADDRESSES_PERSISTED_EVENT, type AddressesPersistedPayload } from '@/client/events'
import { emitAcrossTabs } from '@/helpers/tabEvents'

/** The addresses this tab last announced, as a comparable key. Cleared when the client stops. */
let lastAnnounced: string | undefined

const addressKey = ({ owned, watched }: AddressesPersistedPayload): string => {
  const norm = (list: string[]) => [...new Set(list.map((a) => a.trim().toLowerCase()))].sort()
  return JSON.stringify({ owned: norm(owned), watched: norm(watched) })
}

/**
 * Emits ADDRESSES_PERSISTED_EVENT when the stored addresses differ from the ones this tab last
 * announced. Listeners re-key their queries on it (React's `useItems` reloads its list from
 * scratch), and wallets save the same addresses on every connect.
 */
export function announceAddressesPersisted(payload: AddressesPersistedPayload): void {
  const key = addressKey(payload)
  if (key === lastAnnounced) return
  lastAnnounced = key
  emitAcrossTabs(ADDRESSES_PERSISTED_EVENT, payload)
}

/** Forgets the last announcement, so the next client's first save is announced. */
export function resetAddressesPersistedAnnouncement(): void {
  lastAnnounced = undefined
}
