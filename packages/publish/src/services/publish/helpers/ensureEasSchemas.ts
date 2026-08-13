import {
  getSegmentedItemProperties,
  getRelatedItemsForPublish,
  INTERNAL_DATA_TYPES,
  getEasSchemaForItemProperty,
  setSchemaUidForSchemaDefinition,
  setSchemaUidForModel,
} from '@seedprotocol/sdk'
import type { IItem } from '@seedprotocol/sdk'
import { SchemaRegistry } from '@ethereum-attestation-service/eas-sdk'
import { getSchemaRecord, registerSchema } from '~/helpers/schemaRegistry'
import { prepareNameSchemaAttestation } from '~/helpers/nameSchemaAttestation'
import { waitForPublishReceipt } from '~/helpers/chainClient'
import type { SeedSigner } from '~/helpers/seedSigner'
import { asSeedSigner } from '~/helpers/seedSigner'
import type { Account } from 'thirdweb/wallets'

const RESOLVER_ADDRESS = '0x0000000000000000000000000000000000000000'
const REVOCABLE = true

function toSnakeCase(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()
}

/**
 * Collects all model names used by the item (item's model + relation refs + list refs + Image).
 */
async function getModelNamesForItem(item: IItem<any>): Promise<Set<string>> {
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

  for (const prop of itemImageProperties) {
    const dataType = prop.propertyDef?.dataType
    if (dataType === 'File') modelNames.add('File')
    else if (dataType === 'Html') modelNames.add('Html')
    else modelNames.add('Image')
  }

  for (const prop of itemListProperties) {
    const ref = prop.propertyDef?.ref as string | undefined
    if (ref) modelNames.add(ref)
  }

  return modelNames
}

async function sendAndWait(signer: SeedSigner, tx: Parameters<SeedSigner['sendTransaction']>[0]) {
  const result = await signer.sendTransaction(tx)
  await waitForPublishReceipt(result.transactionHash)
}

/**
 * Ensures EAS schemas exist for each item property and each model used by the item.
 * If a schema is not found on-chain or in the indexer, registers it via SchemaRegistry
 * and creates a name attestation (Schema #1) so EASSCAN displays it.
 */
export async function ensureEasSchemasForItem(
  item: IItem<any>,
  account: Account | SeedSigner,
): Promise<void> {
  const signer = asSeedSigner(account)
  const { itemBasicProperties, itemRelationProperties, itemImageProperties, itemListProperties } =
    await getSegmentedItemProperties(item)

  const allProperties = [
    ...itemBasicProperties,
    ...itemRelationProperties,
    ...itemImageProperties,
    ...itemListProperties,
  ]

  const registeredSchemaUids = new Set<string>()

  const modelNames = await getModelNamesForItem(item)
  const registeredModelSchemaUids = new Set<string>()

  for (const modelName of modelNames) {
    const schemaDef = `bytes32 ${toSnakeCase(modelName)}`
    const schemaUid = SchemaRegistry.getSchemaUID(
      schemaDef,
      RESOLVER_ADDRESS as `0x${string}`,
      REVOCABLE,
    )

    const onChainRecord = await getSchemaRecord(schemaUid)
    if (onChainRecord) {
      setSchemaUidForModel({ modelName, schemaUid })
      continue
    }

    if (registeredModelSchemaUids.has(schemaUid)) {
      setSchemaUidForModel({ modelName, schemaUid })
      continue
    }

    try {
      await sendAndWait(
        signer,
        registerSchema({
          schema: schemaDef,
          resolverAddress: RESOLVER_ADDRESS,
          revocable: REVOCABLE,
        }),
      )
    } catch (err) {
      throw new Error(
        `Failed to register EAS schema for model ${modelName}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    try {
      await sendAndWait(
        signer,
        prepareNameSchemaAttestation({
          schemaUid,
          schemaName: toSnakeCase(modelName),
        }),
      )
    } catch (err) {
      throw new Error(
        `Failed to name EAS schema for model ${modelName}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    registeredModelSchemaUids.add(schemaUid)
    setSchemaUidForModel({ modelName, schemaUid })
  }

  const storageSchemaDef = 'string storage_transaction_id'
  const storageSchemaUid = SchemaRegistry.getSchemaUID(
    storageSchemaDef,
    RESOLVER_ADDRESS as `0x${string}`,
    REVOCABLE,
  )
  const storageOnChain = await getSchemaRecord(storageSchemaUid)
  if (storageOnChain) {
    setSchemaUidForSchemaDefinition({ text: storageSchemaDef, schemaUid: storageSchemaUid })
  } else if (
    !registeredSchemaUids.has(storageSchemaUid) &&
    (modelNames.has('Image') || modelNames.has('File') || modelNames.has('Html'))
  ) {
    try {
      await sendAndWait(
        signer,
        registerSchema({
          schema: storageSchemaDef,
          resolverAddress: RESOLVER_ADDRESS,
          revocable: REVOCABLE,
        }),
      )
      await sendAndWait(
        signer,
        prepareNameSchemaAttestation({
          schemaUid: storageSchemaUid,
          schemaName: 'storage_transaction_id',
        }),
      )
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
      (INTERNAL_DATA_TYPES as Record<string, { eas?: string }>)[property.propertyDef.dataType]?.eas ??
      'string'
    const prop = property as { storagePropertyName?: string; propertyName: string }
    const nameForEas =
      prop.storagePropertyName && prop.storagePropertyName.length > 0
        ? prop.storagePropertyName
        : property.propertyName
    const propertyNameSnakeCase = toSnakeCase(nameForEas)
    const schemaDef = `${easDataTypeRaw} ${propertyNameSnakeCase}`

    const validEasTypes = [
      'string',
      'address',
      'bool',
      'bytes',
      'bytes32',
      'uint8',
      'uint16',
      'uint32',
      'uint64',
      'uint128',
      'uint256',
    ] as const
    const easDataTypeForLookup = validEasTypes.includes(
      easDataTypeRaw as (typeof validEasTypes)[number],
    )
      ? (easDataTypeRaw as (typeof validEasTypes)[number])
      : undefined

    const schema = await getEasSchemaForItemProperty({
      schemaUid: property.schemaUid,
      propertyName: nameForEas,
      easDataType: easDataTypeForLookup,
    })

    if (schema) {
      const onChainRecord = await getSchemaRecord(schema.id)
      const matches = onChainRecord && onChainRecord.schema === schemaDef
      if (matches) {
        setSchemaUidForSchemaDefinition({ text: schemaDef, schemaUid: schema.id })
        continue
      }
    }

    const schemaUid = SchemaRegistry.getSchemaUID(
      schemaDef,
      RESOLVER_ADDRESS as `0x${string}`,
      REVOCABLE,
    )
    const onChainRecord = await getSchemaRecord(schemaUid)

    if (onChainRecord) {
      setSchemaUidForSchemaDefinition({ text: schemaDef, schemaUid })
      continue
    }

    if (registeredSchemaUids.has(schemaUid)) {
      setSchemaUidForSchemaDefinition({ text: schemaDef, schemaUid })
      continue
    }

    try {
      await sendAndWait(
        signer,
        registerSchema({
          schema: schemaDef,
          resolverAddress: RESOLVER_ADDRESS,
          revocable: REVOCABLE,
        }),
      )
    } catch (err) {
      throw new Error(
        `Failed to register EAS schema for property ${property.propertyName}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    try {
      await sendAndWait(
        signer,
        prepareNameSchemaAttestation({
          schemaUid,
          schemaName: propertyNameSnakeCase,
        }),
      )
    } catch (err) {
      throw new Error(
        `Failed to name EAS schema for property ${property.propertyName}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    registeredSchemaUids.add(schemaUid)
    setSchemaUidForSchemaDefinition({ text: schemaDef, schemaUid })
  }

  const relatedItems = await getRelatedItemsForPublish(item)
  for (const relatedItem of relatedItems) {
    await ensureEasSchemasForItem(relatedItem as IItem<any>, signer)
  }
}
