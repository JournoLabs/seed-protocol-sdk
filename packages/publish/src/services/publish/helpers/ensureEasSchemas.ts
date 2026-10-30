import {
  getPublishGraph,
  getPublishModels,
  INTERNAL_DATA_TYPES,
  normalizeDataType,
  getEasSchemaUidForExactDefinition,
  setSchemaUidForSchemaDefinition,
  setSchemaUidForModel,
  listRelationEasPropertyName,
  easName,
  easPropertyNameForPublish,
  publishRemovesValue,
} from '@seedprotocol/sdk'
import type {
  GetPublishModelsOptions,
  IItem,
  PublishGraphNode,
  PublishGraphProperty,
  PublishModel,
} from '@seedprotocol/sdk'
import { SchemaRegistry } from '@ethereum-attestation-service/eas-sdk'
import { getSchemaRecord, registerSchema } from '~/helpers/schemaRegistry'
import { prepareNameSchemaAttestation } from '~/helpers/nameSchemaAttestation'
import { waitForPublishReceipt } from '~/helpers/chainClient'
import { getPublishViemChain } from '~/helpers/chainConfig'
import { EAS_SCHEMA_NAME_ATTESTATION_UID } from '~/helpers/constants'
import { EasSchemasNotRegisteredError } from '~/errors'
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

const STORAGE_MODEL_NAMES = new Set(['Image', 'File', 'Html'])
const STORAGE_TRANSACTION_SCHEMA_DEF = 'string storage_transaction_id'

const hasValue = (property: Pick<PublishGraphProperty, 'row'>): boolean =>
  property.row?.propertyValue != null && property.row.propertyValue !== ''

/** Whether this publish may upload a file for `node`, which it attests as the node's storage transaction. */
function nodeMayUpload(node: PublishGraphNode): boolean {
  return (
    node.kind === 'storageSeed' ||
    node.kind === 'embeddedImage' ||
    STORAGE_MODEL_NAMES.has(node.modelName) ||
    node.properties.some((p) => p.kind === 'itemStorage' && hasValue(p))
  )
}

/**
 * Whether this publish can attest `property`: it has a value, or its empty value removes a live
 * attestation (ADR 0021). An empty property that was never attested attests nothing, so its schema
 * isn't needed. A deferred property is left out of this publish.
 */
async function publishMayAttest(node: PublishGraphNode, property: PublishGraphProperty): Promise<boolean> {
  if (property.deferred) return false
  return hasValue(property) || (await publishRemovesValue(node, property))
}

/** Whether `property` attests under a schema of its own (the storage transaction has one shared schema). */
const hasOwnSchema = (property: Pick<PublishGraphProperty, 'kind'>): boolean =>
  // ItemStorage files are not attested
  property.kind !== 'storageTransaction' && property.kind !== 'itemStorage'

async function sendAndWait(txSender: SeedTxSender, tx: Parameters<SeedTxSender['sendTransaction']>[0]) {
  const result = await txSender.sendTransaction(tx)
  await waitForPublishReceipt(result.transactionHash)
}

export type EnsureEasSchemasOptions = {
  /**
   * ManagedAccount address. When `account` is an active automation session key on this
   * account, missing schemas throw EasSchemasNotRegisteredError instead of being registered
   * (session keys cannot call SchemaRegistry or EAS).
   */
  managedAddress?: string
}

export type EnsureEasSchemasForModelsOptions = EnsureEasSchemasOptions &
  GetPublishModelsOptions & {
    /** Return the missing definitions without registering them. An automation key doesn't throw. */
    dryRun?: boolean
  }

export type EnsureEasSchemasResult = {
  /** Schema definitions that weren't registered when the call started, e.g. `string word_count`. */
  missing: string[]
  /** The definitions this call registered (and named). Empty for a dry run. */
  registered: string[]
}

function easTypeForDataType(dataType: string | undefined): string {
  const key = normalizeDataType(dataType)
  return (
    (INTERNAL_DATA_TYPES as Record<string, { eas?: string }>)[key]?.eas ?? 'string'
  )
}

/** One EAS schema a publish attests under. */
type RequiredSchema = {
  definition: string
  /** Its UID with the zero resolver, revocable: the one this package registers. */
  uid: string
  /** The name its "Name a Schema" attestation gives it. */
  name: string
  /** What a failed registration names, e.g. `property title`. */
  label: string
  /** Models whose seeds attest under it. */
  modelNames: string[]
  /** Property and storage-transaction schemas are cached by definition for the payload. */
  byDefinition: boolean
  /** A property's schema may be registered with another resolver; the indexer finds it by definition. */
  lookupByDefinition: boolean
}

/** Required schemas by definition, so a definition two models or properties share is checked and registered once. */
type RequiredSchemas = Map<string, RequiredSchema>

function requireSchema(
  required: RequiredSchemas,
  definition: string,
  fields: Pick<RequiredSchema, 'name' | 'label'> & { modelName?: string; byDefinition?: boolean },
): void {
  let entry = required.get(definition)
  if (!entry) {
    entry = {
      definition,
      uid: SchemaRegistry.getSchemaUID(definition, RESOLVER_ADDRESS as `0x${string}`, REVOCABLE),
      name: fields.name,
      label: fields.label,
      modelNames: [],
      byDefinition: false,
      lookupByDefinition: false,
    }
    required.set(definition, entry)
  }
  if (fields.modelName && !entry.modelNames.includes(fields.modelName)) entry.modelNames.push(fields.modelName)
  if (fields.byDefinition) {
    entry.byDefinition = true
    entry.lookupByDefinition = true
  }
}

function requireModel(required: RequiredSchemas, modelName: string): void {
  requireSchema(required, `bytes32 ${easName(modelName)}`, {
    name: easName(modelName),
    label: `model ${modelName}`,
    modelName,
  })
}

function requireProperty(required: RequiredSchemas, { key, definition }: Pick<PublishGraphProperty, 'key' | 'definition'>): void {
  // ADR 0008: the same name getPublishPayload attests under (list relations: storage name;
  // single relations: schema key).
  const listRelationName = listRelationEasPropertyName(key, definition)
  const name = easPropertyNameForPublish(key, definition as Parameters<typeof easPropertyNameForPublish>[1])
  const schemaDef = `${easTypeForDataType(definition.dataType)} ${name}`
  if (listRelationName && !name.endsWith('_ids')) {
    throw new Error(
      `Refusing to register "${schemaDef}" for list-relation property ${key}: list relations attest as <singular>_<ref>_ids.`,
    )
  }
  requireSchema(required, schemaDef, { name, label: `property ${key}`, byDefinition: true })
}

function requireStorageTransaction(required: RequiredSchemas): void {
  requireSchema(required, STORAGE_TRANSACTION_SCHEMA_DEF, {
    name: 'storage_transaction_id',
    label: 'storageTransactionId',
    byDefinition: true,
  })
}

/**
 * The schemas a publish of this graph attests under: each node's own model (a draft it refers to
 * is a node of its own, and a published one is attested by uid under the referring property's
 * schema), the properties it can attest, and the storage transaction of a node that uploads.
 */
async function requiredForGraph(nodes: PublishGraphNode[]): Promise<RequiredSchemas> {
  const required: RequiredSchemas = new Map()
  for (const node of nodes) {
    requireModel(required, node.modelName)
    if (nodeMayUpload(node)) requireStorageTransaction(required)
    for (const property of node.properties) {
      if (hasOwnSchema(property) && (await publishMayAttest(node, property))) requireProperty(required, property)
    }
  }
  return required
}

/** The schemas any publish of these models can attest under: each model, every property, and the storage transaction. */
function requiredForModels(models: PublishModel[]): RequiredSchemas {
  const required: RequiredSchemas = new Map()
  for (const model of models) {
    requireModel(required, model.modelName)
    if (STORAGE_MODEL_NAMES.has(model.modelName) || model.properties.some((p) => p.kind === 'itemStorage')) {
      requireStorageTransaction(required)
    }
    for (const property of model.properties) {
      if (hasOwnSchema(property)) requireProperty(required, property)
    }
  }
  return required
}

/** The UID `entry` is registered under on this chain, if any. */
async function findRegisteredUid(entry: RequiredSchema): Promise<string | undefined> {
  if (entry.lookupByDefinition) {
    // Already on EAS under this exact definition (a name alone matches schemas of any type)
    const existingUid = await getEasSchemaUidForExactDefinition(entry.definition).catch(() => undefined)
    if (existingUid) {
      const record = await getSchemaRecord(existingUid)
      if (record && record.schema === entry.definition) return existingUid
    }
  }
  return (await getSchemaRecord(entry.uid)) ? entry.uid : undefined
}

/** Records the UID for the payload, which reads models' and definitions' UIDs from the cache. */
function cacheUid(entry: RequiredSchema, schemaUid: string): void {
  for (const modelName of entry.modelNames) setSchemaUidForModel({ modelName, schemaUid })
  if (entry.byDefinition) setSchemaUidForSchemaDefinition({ text: entry.definition, schemaUid })
}

/** The required schemas not registered on this chain. Caches the UIDs of the rest. */
async function findMissing(required: RequiredSchemas): Promise<RequiredSchema[]> {
  const missing: RequiredSchema[] = []
  for (const entry of required.values()) {
    const uid = await findRegisteredUid(entry)
    if (uid) cacheUid(entry, uid)
    else missing.push(entry)
  }
  return missing
}

/** Registers each schema via SchemaRegistry and names it (Schema #1) so EASSCAN displays it. */
async function registerSchemas(missing: RequiredSchema[], sender: SeedTxSender): Promise<void> {
  for (const entry of missing) {
    try {
      await sendAndWait(
        sender,
        registerSchema({
          schema: entry.definition,
          resolverAddress: RESOLVER_ADDRESS,
          revocable: REVOCABLE,
        }),
      )
    } catch (err) {
      throw new Error(
        `Failed to register EAS schema for ${entry.label}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    try {
      await sendAndWait(sender, prepareNameSchemaAttestation({ schemaUid: entry.uid, schemaName: entry.name }))
    } catch (err) {
      throw new Error(
        `Failed to name EAS schema for ${entry.label}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    cacheUid(entry, entry.uid)
  }
}

/**
 * Checks the Seed-wide schemas every publish depends on: "Name a Schema" (used to name every other
 * schema) and Version. Their UIDs are the same on every chain. The protocol registers them on each
 * supported chain (seed-protocol `npx hardhat seed:ensure-schemas`); the SDK does not, so a missing one is a
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
        'The protocol registers base schemas for each supported chain (seed-protocol: npx hardhat seed:ensure-schemas).',
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
 * Checks the schemas `collect` returns and registers the missing ones, or throws
 * EasSchemasNotRegisteredError for an automation key, before sending anything.
 */
async function ensureSchemas(
  caller: string,
  account: PublishWallet | SeedTxSender,
  options: EnsureEasSchemasOptions | undefined,
  collect: () => Promise<RequiredSchemas>,
  dryRun = false,
): Promise<EnsureEasSchemasResult> {
  const blockSchemaRegistration = await resolveBlockSchemaRegistration(account, options)
  const sender = isPublishWallet(account) ? account.txSender : isSeedTxSender(account) ? account : undefined
  if (!sender) throw new Error(`@seedprotocol/publish: ${caller} requires a PublishWallet or SeedTxSender`)
  await assertBaseSchemas()

  const missing = await findMissing(await collect())
  const definitions = missing.map((entry) => entry.definition)
  if (dryRun || missing.length === 0) return { missing: definitions, registered: [] }
  if (blockSchemaRegistration) throw new EasSchemasNotRegisteredError(definitions)
  await registerSchemas(missing, sender)
  return { missing: definitions, registered: definitions }
}

/**
 * Ensures EAS schemas exist for every seed a publish of the item attests (the item and the drafts
 * published with it, see the SDK's getPublishGraph): its model, the properties the publish can
 * attest (those with a value, or an empty value that removes a live attestation), and the storage
 * transaction of a seed that uploads a file. Registers and names the missing ones.
 * Automation session keys cannot register; a missing schema throws EasSchemasNotRegisteredError
 * before any UserOp.
 */
export async function ensureEasSchemasForItem(
  item: Pick<IItem<any>, 'seedLocalId' | 'modelName'>,
  account: PublishWallet | SeedTxSender,
  options?: EnsureEasSchemasOptions,
): Promise<EnsureEasSchemasResult> {
  return ensureSchemas('ensureEasSchemasForItem', account, options, async () =>
    requiredForGraph((await getPublishGraph(item)).nodes),
  )
}

/**
 * Ensures EAS schemas exist for everything a publish of items of `modelNames` can attest, read
 * from the model definitions the client loaded, with no item: each model, every property (list
 * relations as `<singular>_<ref>_ids`), the storage models (Image, File, Html) its storage-seed
 * properties reach, with their properties, and `string storage_transaction_id`. With `followRefs`
 * (default) also the models relation and list properties name, each once (see the SDK's
 * getPublishModels).
 *
 * The owner wallet calls it so automation, which can't register schemas, finds them. A call with
 * everything registered only reads. An automation session key throws EasSchemasNotRegisteredError
 * when something is missing; `dryRun` returns the missing definitions without sending.
 */
export async function ensureEasSchemasForModels(
  modelNames: string[],
  account: PublishWallet | SeedTxSender,
  options: EnsureEasSchemasForModelsOptions = {},
): Promise<EnsureEasSchemasResult> {
  const { schemaName, followRefs, dryRun } = options
  return ensureSchemas(
    'ensureEasSchemasForModels',
    account,
    options,
    async () => requiredForModels(await getPublishModels(modelNames, { schemaName, followRefs })),
    dryRun,
  )
}
