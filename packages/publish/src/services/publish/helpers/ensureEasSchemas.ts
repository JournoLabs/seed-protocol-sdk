import {
  getSegmentedItemProperties,
  getRelatedItemsForPublish,
  INTERNAL_DATA_TYPES,
  ModelPropertyDataTypes,
  normalizeDataType,
  getEasSchemaForItemProperty,
  setSchemaUidForSchemaDefinition,
  setSchemaUidForModel,
} from '@seedprotocol/sdk'
import type { IItem } from '@seedprotocol/sdk'
import { SchemaRegistry } from '@ethereum-attestation-service/eas-sdk'
import { getSchemaRecord, registerSchema } from '~/helpers/schemaRegistry'
import { prepareNameSchemaAttestation } from '~/helpers/nameSchemaAttestation'
import { waitForPublishReceipt } from '~/helpers/chainClient'
import {
  isPublishWallet,
  isSeedTxSender,
  type PublishWallet,
  type SeedTxSender,
} from '~/helpers/seedSigner'

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
    const dataType = normalizeDataType(prop.propertyDef?.dataType)
    if (dataType === ModelPropertyDataTypes.File) modelNames.add('File')
    else if (dataType === ModelPropertyDataTypes.Html) modelNames.add('Html')
    else modelNames.add('Image')
  }

  for (const prop of itemListProperties) {
    const ref = prop.propertyDef?.ref as string | undefined
    if (ref) modelNames.add(ref)
  }

  return modelNames
}

async function sendAndWait(txSender: SeedTxSender, tx: Parameters<SeedTxSender['sendTransaction']>[0]) {
  const result = await txSender.sendTransaction(tx)
  await waitForPublishReceipt(result.transactionHash)
}

export type EnsureEasSchemasOptions = {
  /**
   * ManagedAccount address. When `account` is an active automation session key on this
   * account, missing schemas throw instead of being registered (session keys cannot call
   * SchemaRegistry or EAS).
   */
  managedAddress?: string
}

type EnsureEasSchemasRunOptions = EnsureEasSchemasOptions & {
  blockSchemaRegistration?: boolean
}

function easTypeForDataType(dataType: string | undefined): string {
  const key = normalizeDataType(dataType)
  return (
    (INTERNAL_DATA_TYPES as Record<string, { eas?: string }>)[key]?.eas ?? 'string'
  )
}

function throwIfAutomationCannotRegister(blockSchemaRegistration: boolean, schemaDef: string): void {
  if (!blockSchemaRegistration) return
  throw new Error(
    `schema "${schemaDef}" is not registered; automation keys can't register schemas. Call ensureEasSchemasForItem with the owner wallet first.`,
  )
}

async function resolveBlockSchemaRegistration(
  account: PublishWallet | SeedTxSender,
  options: EnsureEasSchemasRunOptions | undefined,
): Promise<boolean> {
  if (typeof options?.blockSchemaRegistration === 'boolean') {
    return options.blockSchemaRegistration
  }
  const managedAddress = options?.managedAddress?.trim()
  if (!managedAddress || !isPublishWallet(account)) return false
  const { isAutomationSessionActive } = await import('~/helpers/ensureAutomationSessionKey')
  return isAutomationSessionActive(managedAddress, account.signer.address)
}

/**
 * Ensures EAS schemas exist for each item property and each model used by the item.
 * If a schema is not found on-chain or in the indexer, registers it via SchemaRegistry
 * and creates a name attestation (Schema #1) so EASSCAN displays it.
 * Automation session keys cannot register; a missing schema throws before any UserOp.
 */
export async function ensureEasSchemasForItem(
  item: IItem<any>,
  account: PublishWallet | SeedTxSender,
  options?: EnsureEasSchemasOptions,
): Promise<void> {
  await ensureEasSchemasForItemResolved(item, account, options)
}

async function ensureEasSchemasForItemResolved(
  item: IItem<any>,
  account: PublishWallet | SeedTxSender,
  options?: EnsureEasSchemasRunOptions,
): Promise<void> {
  const blockSchemaRegistration = await resolveBlockSchemaRegistration(account, options)
  const sender: SeedTxSender = isPublishWallet(account)
    ? account.txSender
    : isSeedTxSender(account)
      ? account
      : (() => {
          throw new Error(
            '@seedprotocol/publish: ensureEasSchemasForItem requires a PublishWallet or SeedTxSender',
          )
        })()
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

    throwIfAutomationCannotRegister(blockSchemaRegistration, schemaDef)

    try {
      await sendAndWait(
        sender,
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
        sender,
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
    throwIfAutomationCannotRegister(blockSchemaRegistration, storageSchemaDef)
    try {
      await sendAndWait(
        sender,
        registerSchema({
          schema: storageSchemaDef,
          resolverAddress: RESOLVER_ADDRESS,
          revocable: REVOCABLE,
        }),
      )
      await sendAndWait(
        sender,
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

    const easDataTypeRaw = easTypeForDataType(property.propertyDef.dataType)
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

    throwIfAutomationCannotRegister(blockSchemaRegistration, schemaDef)

    try {
      await sendAndWait(
        sender,
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
        sender,
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
    await ensureEasSchemasForItemResolved(relatedItem as IItem<any>, account, {
      managedAddress: options?.managedAddress,
      blockSchemaRegistration,
    })
  }
}
