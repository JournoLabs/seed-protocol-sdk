/**
 * Must match `ADDRESSES_PERSISTED_EVENT` in `@seedprotocol/sdk` / `client/events.ts`
 * (emitted after `setAddresses` persists to `app_state`).
 */
export const ADDRESSES_PERSISTED_EVENT = 'addresses.persisted' as const
