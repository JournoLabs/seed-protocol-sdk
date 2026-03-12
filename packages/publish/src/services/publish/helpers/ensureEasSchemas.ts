import {
  getSegmentedItemProperties,
  getRelatedItemsForPublish,
  INTERNAL_DATA_TYPES,
  getEasSchemaForItemProperty,
  setSchemaUidForSchemaDefinition,
  setSchemaUidForModel,
} from '@seedprotocol/sdk'
import type { Item } from '@seedprotocol/sdk'

type ItemInstance = InstanceType<typeof Item>
import { SchemaRegistry } from '@ethereum-attestation-service/eas-sdk'
import type { ThirdwebClient } from 'thirdweb'
import type { Chain } from 'thirdweb/chains'
import { sendTransaction, waitForReceipt } from 'thirdweb'
import type { Account } from 'thirdweb/wallets'
import { getSchemaRecord, registerSchema } from '~/helpers/thirdweb/11155420/schemaRegistry'
import { prepareNameSchemaAttestation } from '~/helpers/thirdweb/11155420/nameSchemaAttestation'

const RESOLVER_ADDRESS = '0x0000000000000000000000000000000000000000'
const REVOCABLE = true

function toSnakeCase(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()
}

/**
 * Collects all model names used by the item (item's model + relation refs + list refs + Image).
 */
async function getModelNamesForItem(item: ItemInstance): Promise<Set<string>> {
  const { itemRelationProperties, itemImageProperties, itemListProperties } =
    await getSegmentedItemProperties(item)
  const modelNames = new Set<string>()

  if (item.modelName) {
    modelNames.add(item.modelName)
  }

  for (const prop of itemRelationProperties) {
    const ref = prop.propertyDef?.ref as string | undefined
    if (ref) modelNames.add(ref)
  }

  for (const _prop of itemImageProperties) {
    modelNames.add('Image')
  }

  for (const prop of itemListProperties) {
    const ref = prop.propertyDef?.ref as string | undefined
    if (ref) modelNames.add(ref)
  }

  return modelNames
}

/**
 * Ensures EAS schemas exist for each item property and each model used by the item.
 * If a schema is not found on-chain or in the indexer, registers it via SchemaRegistry
 * and creates a name attestation (Schema #1) so EASSCAN displays it.
 * Populates the SDK's schema map so getPublishPayload can resolve schema UIDs.
 */
export async function ensureEasSchemasForItem(
  item: ItemInstance,
  account: Account,
  client: ThirdwebClient,
  chain: Chain,
): Promise<void> {
  const { itemBasicProperties, itemRelationProperties, itemImageProperties, itemListProperties } =
    await getSegmentedItemProperties(item)

  const allProperties = [
    ...itemBasicProperties,
    ...itemRelationProperties,
    ...itemImageProperties,
    ...itemListProperties,
  ]

  const registeredSchemaUids = new Set<string>()

  // Ensure model schemas (bytes32 <model_name>) so getPublishPayload can resolve seedSchemaUid
  const modelNames = await getModelNamesForItem(item)
  const registeredModelSchemaUids = new Set<string>()

  for (const modelName of modelNames) {
    const schemaDef = `bytes32 ${toSnakeCase(modelName)}`
    const schemaUid = SchemaRegistry.getSchemaUID(
      schemaDef,
      RESOLVER_ADDRESS as `0x${string}`,
      REVOCABLE,
    )

    const onChainRecord = await getSchemaRecord(client, chain, schemaUid)
    if (onChainRecord) {
      setSchemaUidForModel({ modelName, schemaUid })
      continue
    }

    if (registeredModelSchemaUids.has(schemaUid)) {
      setSchemaUidForModel({ modelName, schemaUid })
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
        `Failed to register EAS schema for model ${modelName}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    try {
      const attestTx = prepareNameSchemaAttestation(client, chain, {
        schemaUid,
        schemaName: toSnakeCase(modelName),
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
        `Failed to name EAS schema for model ${modelName}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    registeredModelSchemaUids.add(schemaUid)
    setSchemaUidForModel({ modelName, schemaUid })
  }

  // Ensure storage seed property schemas (Image/File/Html models have storageTransactionId).
  // The top-level item doesn't have these properties, but nested storage seeds do.
  const storageSchemaDef = 'string storage_transaction_id'
  const storageSchemaUid = SchemaRegistry.getSchemaUID(
    storageSchemaDef,
    RESOLVER_ADDRESS as `0x${string}`,
    REVOCABLE,
  )
  const storageOnChain = await getSchemaRecord(client, chain, storageSchemaUid)
  if (storageOnChain) {
    setSchemaUidForSchemaDefinition({ text: storageSchemaDef, schemaUid: storageSchemaUid })
  } else if (!registeredSchemaUids.has(storageSchemaUid) && (modelNames.has('Image') || modelNames.has('File') || modelNames.has('Html'))) {
    try {
      const registerTx = registerSchema(client, chain, {
        schema: storageSchemaDef,
        resolverAddress: RESOLVER_ADDRESS,
        revocable: REVOCABLE,
      })
      const registerResult = await sendTransaction({ account, transaction: registerTx })
      await waitForReceipt({ client, chain, transactionHash: registerResult.transactionHash })
      const attestTx = prepareNameSchemaAttestation(client, chain, {
        schemaUid: storageSchemaUid,
        schemaName: 'storage_transaction_id',
      })
      const attestResult = await sendTransaction({ account, transaction: attestTx })
      await waitForReceipt({ client, chain, transactionHash: attestResult.transactionHash })
    } catch (err) {
      throw new Error(
        `Failed to register EAS schema for storageTransactionId: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    registeredSchemaUids.add(storageSchemaUid)
    setSchemaUidForSchemaDefinition({ text: storageSchemaDef, schemaUid: storageSchemaUid })
  }

  for (const property of allProperties) {
    if (!property.propertyDef) continue

    const easDataTypeRaw =
      (INTERNAL_DATA_TYPES as Record<string, { eas?: string }>)[property.propertyDef.dataType]?.eas ?? 'string'
    const propertyNameSnakeCase = toSnakeCase(property.propertyName)
    const schemaDef = `${easDataTypeRaw} ${propertyNameSnakeCase}`

    // getEasSchemaForItemProperty expects TypedData['type'] which excludes 'bytes32[]'
    const validEasTypes = [
      'string', 'address', 'bool', 'bytes', 'bytes32',
      'uint8', 'uint16', 'uint32', 'uint64', 'uint128', 'uint256',
    ] as const
    const easDataTypeForLookup =
      validEasTypes.includes(easDataTypeRaw as (typeof validEasTypes)[number])
        ? (easDataTypeRaw as (typeof validEasTypes)[number])
        : undefined

    let schema = await getEasSchemaForItemProperty({
      schemaUid: property.schemaUid,
      propertyName: property.propertyName,
      easDataType: easDataTypeForLookup,
    })

    if (schema) {
      // Verify SDK schema matches our schemaDef on-chain before trusting it.
      // The SDK may return a cached schema from a different chain/definition.
      const onChainRecord = await getSchemaRecord(client, chain, schema.id)
      const matches = onChainRecord && onChainRecord.schema === schemaDef
      if (matches) {
        setSchemaUidForSchemaDefinition({ text: schemaDef, schemaUid: schema.id })
        continue
      }
      // Schema mismatch or not found: fall through to register/use our schemaDef
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

  // Ensure schemas for related/list items that will be in the multiPublish payload.
  // Without this, schemas for nested items (e.g. Image's properties) are never registered,
  // causing EAS multiAttest to revert with InvalidSchema.
  const relatedItems = await getRelatedItemsForPublish(item)
  for (const relatedItem of relatedItems) {
    await ensureEasSchemasForItem(relatedItem as ItemInstance, account, client, chain)
  }
}
