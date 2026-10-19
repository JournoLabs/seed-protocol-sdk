import debug from 'debug'
import { getEasSchemaUidForExactDefinition } from '@/stores/eas'
import { easSchemaDefinitionForProperty, type PropertySchemaEntry } from '@/helpers/metadataPropertyNames'

const logger = debug('seedSdk:helpers:propertySchemaUid')

/**
 * UID of the EAS schema a property publishes under, or undefined when EAS has none, the property's
 * type has no EAS type, or the lookup fails. Found UIDs and misses are cached
 * (`getEasSchemaUidForExactDefinition`), so creating an item and then saving its properties asks
 * EAS once per definition. Callers store the UID on the metadata row; publish resolves schemas
 * itself, so a missing one costs nothing there.
 */
export async function lookupPropertySchemaUid(
  propertyName: string,
  propertyDef?: (PropertySchemaEntry & { name?: string; refValueType?: string }) | null,
): Promise<string | undefined> {
  const definition = easSchemaDefinitionForProperty(propertyName, propertyDef)
  if (!definition) return undefined
  try {
    return await getEasSchemaUidForExactDefinition(definition)
  } catch (error) {
    logger(`EAS schema lookup for "${definition}" failed (offline?): ${error}`)
    return undefined
  }
}
