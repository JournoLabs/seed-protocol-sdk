import type { PropertyMachineContext } from '@/types/property'

/**
 * Points the context at the row the write left the value in. Editing a published row writes a new
 * draft row: keeping the old row's localId and uid would make patch Publish skip the edit as attested.
 */
export const rowContext = (
  result: { localId: string; uid: string | null } | undefined,
): Partial<PropertyMachineContext> => (result ? { localId: result.localId, uid: result.uid ?? undefined } : {})
