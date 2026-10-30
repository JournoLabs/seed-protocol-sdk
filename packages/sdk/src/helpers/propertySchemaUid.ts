import debug from 'debug'
import { getEasSchemaUidForExactDefinition } from '@seedprotocol/eas'
import { easSchemaDefinitionForProperty, type PropertySchemaEntry } from '@/helpers/metadataPropertyNames'
import type { PropertyType } from '@/types'

const logger = debug('seedSdk:helpers:propertySchemaUid')

/**
 * UID of the EAS schema a property publishes under, or undefined when EAS has none, the property's
 * type has no EAS type, or the lookup fails. Reads `getEasSchemaUidForExactDefinition`, which
 * answers with a UID publish registered in this session before the indexer has it, and caches
 * found UIDs and misses, so creating an item and then saving its properties asks EAS once per
 * definition. May call EAS, so run it before a transaction, not inside one. Callers store the UID
 * on the metadata row; publish resolves schemas itself, so a missing one costs nothing there.
 */
export async function lookupPropertySchemaUid(
  propertyName: string,
  propertyDef?: PropertyType | (PropertySchemaEntry & { name?: string; refValueType?: string }) | null,
): Promise<string | undefined> {
  const definition = easSchemaDefinitionForProperty(
    propertyName,
    propertyDef as Parameters<typeof easSchemaDefinitionForProperty>[1],
  )
  if (!definition) return undefined
  try {
    return await getEasSchemaUidForExactDefinition(definition)
  } catch (error) {
    logger(`EAS schema lookup for "${definition}" failed (offline?): ${error}`)
    return undefined
  }
}
