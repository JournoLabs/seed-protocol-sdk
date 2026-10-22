import {
  getPublishGraph,
  INTERNAL_DATA_TYPES,
  ModelPropertyDataTypes,
  normalizeDataType,
  getEasSchemaUidForExactDefinition,
  setSchemaUidForSchemaDefinition,
  setSchemaUidForModel,
  listRelationEasPropertyName,
  easName,
  easPropertyNameForPublish,
} from '@seedprotocol/sdk'
import type { IItem, PublishGraphNode } from '@seedprotocol/sdk'
import { SchemaRegistry } from '@ethereum-attestation-service/eas-sdk'
import { getSchemaRecord, registerSchema } from '~/helpers/schemaRegistry'
import { prepareNameSchemaAttestation } from '~/helpers/nameSchemaAttestation'
import { waitForPublishReceipt } from '~/helpers/chainClient'
import { getPublishViemChain } from '~/helpers/chainConfig'
import { EAS_SCHEMA_NAME_ATTESTATION_UID } from '~/helpers/constants'
import {
  isPublishWallet,
  isSeedTxSender,
  type PublishWallet,
  type SeedTxSender,
} from '~/helpers/seedSigner'

const RESOLVER_ADDRESS = '0x0000000000000000000000000000000000000000'
const REVOCABLE = true

/** "Name a Schema" (EAS schema #1); UID is {@link EAS_SCHEMA_NAME_ATTESTATION_UID}. */
const NAME_SCHEMA_DEF = 'bytes32 schemaId,string name'
/** Version attestation schema; UID matches the SDK's `VERSION_SCHEMA_UID`. */
const VERSION_SCHEMA_DEF = 'bytes32 version'

/** Chain ids where the base schemas were found (avoids re-reading every publish). */
const chainsWithBaseSchemas = new Set<number>()

/** @internal Tests only. */
export function resetEnsuredBaseSchemas(): void {
  chainsWithBaseSchemas.clear()
}


/**
 * Model names a node's seed and refs attest under: its own model, its relation and list refs, and
 * the storage models (File, Html, else Image) of its storage-seed properties.
 */
function getModelNamesForNode(node: PublishGraphNode): Set<string> {
  const modelNames = new Set<string>([node.modelName])
  for (const { kind, definition } of node.properties) {
    const dataType = normalizeDataType(definition.dataType)
    if ((kind === 'relation' || kind === 'list' || (kind === 'storageSeed' && dataType === ModelPropertyDataTypes.Relation)) && definition.ref) {
      modelNames.add(definition.ref)
    }
    if (kind !== 'storageSeed') continue
    if (dataType === ModelPropertyDataTypes.File) modelNames.add('File')
    else if (dataType === ModelPropertyDataTypes.Html) modelNames.add('Html')
    else modelNames.add('Image')
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

/**
 * Checks the Seed-wide schemas every publish depends on: "Name a Schema" (used to name every other
 * schema) and Version. Their UIDs are the same on every chain. The protocol registers them on each
 * supported chain (seed-protocol `seed:ensure-schemas`); the SDK does not, so a missing one is a
 * chain setup problem and fails before anything is sent.
 */
async function assertBaseSchemas(): Promise<void> {
  const chainId = getPublishViemChain().id
  if (chainsWithBaseSchemas.has(chainId)) return

  const versionSchemaUid = SchemaRegistry.getSchemaUID(
    VERSION_SCHEMA_DEF,
    RESOLVER_ADDRESS as `0x${string}`,
    REVOCABLE,
  )
  const required: Array<[def: string, uid: string]> = [
    [NAME_SCHEMA_DEF, EAS_SCHEMA_NAME_ATTESTATION_UID],
    [VERSION_SCHEMA_DEF, versionSchemaUid],
  ]
  const missing: string[] = []
  for (const [def, uid] of required) {
    if (!(await getSchemaRecord(uid))) missing.push(`"${def}" (${uid})`)
  }
  if (missing.length > 0) {
    throw new Error(
      `Seed base schema${missing.length > 1 ? 's' : ''} ${missing.join(' and ')} not registered on chain ${chainId}. ` +
        'The protocol registers base schemas for each supported chain (seed-protocol: bun run seed:ensure-schemas).',
    )
  }

  chainsWithBaseSchemas.add(chainId)
}

async function resolveBlockSchemaRegistration(
  account: PublishWallet | SeedTxSender,
  options: EnsureEasSchemasOptions | undefined,
): Promise<boolean> {
  const managedAddress = options?.managedAddress?.trim()
  if (!managedAddress || !isPublishWallet(account)) return false
  const { isAutomationSessionActive } = await import('~/helpers/ensureAutomationSessionKey')
  return isAutomationSessionActive(managedAddress, account.signer.address)
}

/**
 * Ensures EAS schemas exist for each property and each model of every seed a publish of the item
 * attests (the item and the drafts published with it, see the SDK's getPublishGraph).
 * If a schema is not found on-chain or in the indexer, registers it via SchemaRegistry
 * and creates a name attestation (Schema #1) so EASSCAN displays it.
 * Automation session keys cannot register; a missing schema throws before any UserOp.
 */
export async function ensureEasSchemasForItem(
  item: Pick<IItem<any>, 'seedLocalId' | 'modelName'>,
  account: PublishWallet | SeedTxSender,
  options?: EnsureEasSchemasOptions,
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
  await assertBaseSchemas()

  const registered = { schemaUids: new Set<string>(), modelSchemaUids: new Set<string>() }
  const graph = await getPublishGraph(item)
  for (const node of graph.nodes) {
    await ensureEasSchemasForNode(node, sender, blockSchemaRegistration, registered)
  }
}

async function ensureEasSchemasForNode(
  node: PublishGraphNode,
  sender: SeedTxSender,
  blockSchemaRegistration: boolean,
  registered: { schemaUids: Set<string>; modelSchemaUids: Set<string> },
): Promise<void> {
  // The storage transaction slot has its own schema below; ItemStorage files are not attested
  const allProperties = node.properties.filter((p) => p.kind !== 'storageTransaction' && p.kind !== 'itemStorage')

  const registeredSchemaUids = registered.schemaUids
  const modelNames = getModelNamesForNode(node)
  const registeredModelSchemaUids = registered.modelSchemaUids

  for (const modelName of modelNames) {
    const schemaDef = `bytes32 ${easName(modelName)}`
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
          schemaName: easName(modelName),
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

  for (const { key: propertyName, definition } of allProperties) {
    const easDataTypeRaw = easTypeForDataType(definition.dataType)
    // ADR 0008: the same name getPublishPayload attests under (list relations: storage name;
    // single relations: schema key).
    const listRelationName = listRelationEasPropertyName(propertyName, definition)
    const propertyNameSnakeCase = easPropertyNameForPublish(
      propertyName,
      definition as Parameters<typeof easPropertyNameForPublish>[1],
    )
    const schemaDef = `${easDataTypeRaw} ${propertyNameSnakeCase}`
    if (listRelationName && !propertyNameSnakeCase.endsWith('_ids')) {
      throw new Error(
        `Refusing to register "${schemaDef}" for list-relation property ${propertyName}: list relations attest as <singular>_<ref>_ids.`,
      )
    }

    // Already on EAS under this exact definition (a name alone matches schemas of any type)
    const existingUid = await getEasSchemaUidForExactDefinition(schemaDef).catch(() => undefined)
    if (existingUid) {
      const onChainRecord = await getSchemaRecord(existingUid)
      if (onChainRecord && onChainRecord.schema === schemaDef) {
        setSchemaUidForSchemaDefinition({ text: schemaDef, schemaUid: existingUid })
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
        `Failed to register EAS schema for property ${propertyName}: ${err instanceof Error ? err.message : String(err)}`,
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
        `Failed to name EAS schema for property ${propertyName}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    registeredSchemaUids.add(schemaUid)
    setSchemaUidForSchemaDefinition({ text: schemaDef, schemaUid })
  }
}
