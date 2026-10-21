import type { ModelSchemaLookup } from '@seedprotocol/eas'
import { nameMatchLevels } from '@/db/read/nameMatchLevels'

/**
 * Local model names (every local model by default) with their nameMatch levels (ADR 0009), for
 * the EAS model schema lookups (fetchEasModelSchemas, matchEasModelSchemas). `Seed` has no model
 * schema and is left out.
 */
export const localModelSchemaLookups = async (modelNames?: readonly string[]): Promise<ModelSchemaLookup[]> => {
  let names = modelNames
  if (!names) {
    // Dynamic import to break circular dependency: Model -> ... -> this module
    const { Model } = await import('../../Model/Model')
    names = (await Model.all()).map((m) => m.modelName).filter((name): name is string => !!name)
  }
  const levels = await nameMatchLevels()
  return names.filter((name) => name !== 'Seed').map((name) => ({ name, level: levels.model(name) }))
}
