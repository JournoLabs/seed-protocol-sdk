// AllItems services have been removed - this handler is no longer needed
// Service state persistence is now handled by entity instances directly

import { saveAppState } from '@/db/write/saveAppState'

type SaveServiceEvent = {
  modelName: string
}

export const saveServiceHandler = async (event: SaveServiceEvent) => {
  // AllItems services removed - this functionality is no longer needed
  // Entity instances (Schema, Model, Item) manage their own state
  console.warn('[saveServiceHandler] AllItems services removed - handler is a no-op')
}
