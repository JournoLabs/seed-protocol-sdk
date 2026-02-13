import {
  getSegmentedItemProperties,
  INTERNAL_DATA_TYPES,
  getEasSchemaForItemProperty,
  setSchemaUidForSchemaDefinition,
} from '@seedprotocol/sdk'
import { SchemaRegistry } from '@ethereum-attestation-service/eas-sdk'
import type { ThirdwebClient } from 'thirdweb'
import type { Chain } from 'thirdweb/chains'
import { sendTransaction, waitForReceipt } from 'thirdweb'
import type { IItem, IItemProperty } from '@seedprotocol/sdk'
import type { Account } from 'thirdweb/wallets'
import { getSchemaRecord, registerSchema } from '~/helpers/thirdweb/11155420/schemaRegistry'
import { prepareNameSchemaAttestation } from '~/helpers/thirdweb/11155420/nameSchemaAttestation'

const RESOLVER_ADDRESS = '0x0000000000000000000000000000000000000000'
const REVOCABLE = true

function toSnakeCase(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()
}

/**
 * Ensures EAS schemas exist for each item property. If a schema is not found on-chain or in the indexer,
 * registers it via SchemaRegistry and creates a name attestation (Schema #1) so EASSCAN displays it.
 * Populates the SDK's schema map so getPublishPayload can resolve schema UIDs.
 */
export async function ensureEasSchemasForItem(
  item: IItem<any>,
  account: Account,
  client: ThirdwebClient,
  chain: Chain,
): Promise<void> {
  const { itemBasicProperties, itemRelationProperties, itemImageProperties, itemListProperties } =
    getSegmentedItemProperties(item)

  const allProperties: IItemProperty<any>[] = [
    ...itemBasicProperties,
    ...itemRelationProperties,
    ...itemImageProperties,
    ...itemListProperties,
  ]

  const registeredSchemaUids = new Set<string>()

  for (const property of allProperties) {
    if (!property.propertyDef) continue

    const easDataType =
      (INTERNAL_DATA_TYPES as Record<string, { eas?: string }>)[property.propertyDef.dataType]?.eas ?? 'string'
    const propertyNameSnakeCase = toSnakeCase(property.propertyName)
    const schemaDef = `${easDataType} ${propertyNameSnakeCase}`

    let schema = await getEasSchemaForItemProperty({
      propertyName: property.propertyName,
      easDataType,
    })

    if (schema) {
      setSchemaUidForSchemaDefinition({ text: schemaDef, schemaUid: schema.id })
      continue
    }

    const schemaUid = SchemaRegistry.getSchemaUID(schemaDef, RESOLVER_ADDRESS as `0x${string}`, REVOCABLE)
    const onChainRecord = await getSchemaRecord(client, chain, schemaUid)

    if (onChainRecord) {
      setSchemaUidForSchemaDefinition({ text: schemaDef, schemaUid })
      continue
    }

    if (registeredSchemaUids.has(schemaUid)) {
      setSchemaUidForSchemaDefinition({ text: schemaDef, schemaUid })
      continue
    }

    try {
      const registerTx = registerSchema(client, chain, {
        schema: schemaDef,
        resolverAddress: RESOLVER_ADDRESS,
        revocable: REVOCABLE,
      })

      const registerResult = await sendTransaction({
        account,
        transaction: registerTx,
      })

      await waitForReceipt({
        client,
        chain,
        transactionHash: registerResult.transactionHash,
      })
    } catch (err) {
      throw new Error(
        `Failed to register EAS schema for property ${property.propertyName}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    try {
      const attestTx = prepareNameSchemaAttestation(client, chain, {
        schemaUid,
        schemaName: propertyNameSnakeCase,
      })

      const attestResult = await sendTransaction({
        account,
        transaction: attestTx,
      })

      await waitForReceipt({
        client,
        chain,
        transactionHash: attestResult.transactionHash,
      })
    } catch (err) {
      throw new Error(
        `Failed to name EAS schema for property ${property.propertyName}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    registeredSchemaUids.add(schemaUid)
    setSchemaUidForSchemaDefinition({ text: schemaDef, schemaUid })
  }
}
