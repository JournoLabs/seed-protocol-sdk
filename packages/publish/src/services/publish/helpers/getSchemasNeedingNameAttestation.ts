import {
  getSegmentedItemProperties,
  INTERNAL_DATA_TYPES,
  getEasSchemaForItemProperty,
} from '@seedprotocol/sdk'

type ItemLike = Parameters<typeof getSegmentedItemProperties>[0]
import { SchemaRegistry } from '@ethereum-attestation-service/eas-sdk'
import type { ThirdwebClient } from 'thirdweb'
import type { Chain } from 'thirdweb/chains'
import { getSchemaRecord } from '~/helpers/thirdweb/11155420/schemaRegistry'

const RESOLVER_ADDRESS = '0x0000000000000000000000000000000000000000'
const REVOCABLE = true

function toSnakeCase(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()
}

export type SchemaNeedingNameAttestation = {
  schemaUid: string
  schemaDef: string
  propertyName: string
}

/**
 * Returns schemas that are registered on-chain but lack a naming attestation.
 * Useful for custom publish flows to detect which schemas need name attestations
 * before deciding to add them (e.g. via ensureEasSchemasForItem).
 */
export async function getSchemasNeedingNameAttestation(
  item: ItemLike,
  client: ThirdwebClient,
  chain: Chain,
): Promise<SchemaNeedingNameAttestation[]> {
  const { itemBasicProperties, itemRelationProperties, itemImageProperties, itemListProperties } =
    getSegmentedItemProperties(item)

  const allProperties = [
    ...itemBasicProperties,
    ...itemRelationProperties,
    ...itemImageProperties,
    ...itemListProperties,
  ]

  const result: SchemaNeedingNameAttestation[] = []

  for (const property of allProperties) {
    if (!property.propertyDef) continue

    const easDataType =
      (INTERNAL_DATA_TYPES as Record<string, { eas?: string }>)[property.propertyDef.dataType]?.eas ?? 'string'
    const propertyNameSnakeCase = toSnakeCase(property.propertyName)
    const schemaDef = `${easDataType} ${propertyNameSnakeCase}`

    const schemaUid = SchemaRegistry.getSchemaUID(
      schemaDef,
      RESOLVER_ADDRESS as `0x${string}`,
      REVOCABLE,
    )

    const onChainRecord = await getSchemaRecord(client, chain, schemaUid)
    if (!onChainRecord) continue

    const schemaById = await getEasSchemaForItemProperty({
      schemaUid,
      propertyName: property.propertyName,
      easDataType,
    })
    const hasNameAttestation = (schemaById?.schemaNames?.length ?? 0) > 0

    if (!hasNameAttestation) {
      result.push({ schemaUid, schemaDef, propertyName: property.propertyName })
    }
  }

  return result
}
