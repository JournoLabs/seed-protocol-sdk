import {
  getItemVersionsFromEas,
  getItemPropertiesFromEas,
  EasClient,
  setSchemaUidForSchemaDefinition,
  withExcludeRevokedFilter,
  pickLatestPropertyAttestationsByRefAndSchema,
  GET_SEEDS,
} from '@seedprotocol/eas'
import { getArweaveUrlForTransaction } from './arweaveUrl.js'
import {
  publicListRelationPropertyKey,
  stripListRelationStorageAliasesForPublicKey,
  tryCoerceJsonStringArray,
} from './listRelationKey.js'
import { enrichImageSeedClone } from './imageRelationEnrichment.js'
import { hydrateArweaveRichTextInItems } from './hydrateArweaveRichText.js'
import { parseEasPropertyMetadata } from './parseEasPropertyMetadata.js'
import {
  setFieldStorageModel,
  setListElementStorageModels,
} from './fieldStorageModel.js'
import type { AssembleOptions, AttestationLike, SeedRecord } from './types.js'

const IMAGE_SCHEMA = 'image'

const relationValuesToExclude = [
  '0x0000000000000000000000000000000000000000000000000000000000000020',
]

const RESERVED_KEYS = new Set([
  'seedUid',
  'SeedUid',
  'timeCreated',
  'attester',
  'Attester',
  'storage_transaction_id',
  'storage_provider_transaction_id',
  'storageTransactionId',
  'storageProviderTransactionId',
  'versionUid',
])

const toCamelCase = (str: string): string => {
  return str.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
}

const parseEasRelationPropertyName = (
  easPropertyName: string,
): { propertyName: string; modelName: string; isList: boolean } | null => {
  const [singularProperty, modelName, idSegment] = easPropertyName.split('_')
  if (!singularProperty || !modelName) return null
  const isList = idSegment === 'ids'
  const propertyName = singularProperty.endsWith('s')
    ? singularProperty
    : singularProperty + 's'
  return { propertyName, modelName, isList }
}

type AssembleContext = {
  seedUidToModelType: Map<string, string>
  relatedSeedUids: Set<string>
  versionUidToSeedUid: Map<string, string>
  assembledItems: Map<string, Record<string, unknown>>
  versionsBySeedUid: Map<string, AttestationLike[]>
  latestVersionUidsBySeedUid: Map<string, string>
}

function createAssembleContext(): AssembleContext {
  return {
    seedUidToModelType: new Map(),
    relatedSeedUids: new Set(),
    versionUidToSeedUid: new Map(),
    assembledItems: new Map(),
    versionsBySeedUid: new Map(),
    latestVersionUidsBySeedUid: new Map(),
  }
}

function ensureSeedIdentity(clone: Record<string, unknown>, seedUid: string): void {
  if (!clone.seedUid && !clone.SeedUid) {
    clone.seedUid = seedUid
    clone.SeedUid = seedUid
  } else if (clone.seedUid && !clone.SeedUid) {
    clone.SeedUid = clone.seedUid
  } else if (clone.SeedUid && !clone.seedUid) {
    clone.seedUid = clone.SeedUid
  }
  if (clone.attester && !clone.Attester) {
    clone.Attester = clone.attester
  } else if (clone.Attester && !clone.attester) {
    clone.attester = clone.Attester
  }
}

async function processItemProperty(
  ctx: AssembleContext,
  property: AttestationLike,
): Promise<void> {
  const parsed = parseEasPropertyMetadata(property.decodedDataJson)
  if (!parsed.ok) {
    const { id, refUID, schemaId } = property
    if (parsed.reason === 'empty') {
      console.warn(
        '[query] [processItemProperty] empty decodedDataJson for property:',
        id,
        refUID,
        schemaId,
      )
    } else if (parsed.reason === 'parse') {
      console.warn(
        '[query] [processItemProperty] failed to parse decodedDataJson for property:',
        id,
        refUID,
        schemaId,
        parsed.error,
      )
    } else {
      console.warn(
        '[query] [processItemProperty] invalid decodedDataJson structure for property:',
        id,
        refUID,
        schemaId,
      )
    }
    return
  }

  const metadata = parsed.metadata

  let propertyNameSnake = metadata.name
  if (!propertyNameSnake) {
    return
  }

  const schemaUid = property.schemaId
  setSchemaUidForSchemaDefinition({
    text: propertyNameSnake,
    schemaUid,
  })

  let isRelation = false
  let isList = false
  const easType = metadata.type
  const isBytes32Relation =
    (easType === 'bytes32' || easType === 'bytes32[]') &&
    propertyNameSnake !== 'storage_transaction_id' &&
    propertyNameSnake !== 'storage_provider_transaction_id'
  const isNamingConventionRelation =
    !isBytes32Relation &&
    (propertyNameSnake.endsWith('_id') || propertyNameSnake.endsWith('_ids')) &&
    propertyNameSnake !== 'storage_transaction_id' &&
    propertyNameSnake !== 'storage_provider_transaction_id'

  if (isBytes32Relation || isNamingConventionRelation) {
    isRelation = true
    if (Array.isArray(metadata.value)) {
      isList = true
      if (isNamingConventionRelation) {
        const result = parseEasRelationPropertyName(propertyNameSnake)
        if (result) {
          propertyNameSnake = result.propertyName
        }
      }
      metadata.value.forEach((value: string) => {
        if (!relationValuesToExclude.includes(value)) ctx.relatedSeedUids.add(value)
      })
    } else if (!relationValuesToExclude.includes(metadata.value as string)) {
      ctx.relatedSeedUids.add(metadata.value as string)
    }
  }

  let propertyValue: string | string[] = metadata.value as string | string[]
  if (isRelation && isList && Array.isArray(propertyValue)) {
    propertyValue = propertyValue.map((v) => String(v))
  } else if (typeof propertyValue !== 'string') {
    propertyValue = JSON.stringify(propertyValue)
  }

  const seedUidForProperty = ctx.versionUidToSeedUid.get(property.refUID)
  if (!seedUidForProperty) {
    return
  }

  const existingItem = ctx.assembledItems.get(seedUidForProperty) || {}
  existingItem[propertyNameSnake] = propertyValue
  const propertyNameCamel = toCamelCase(propertyNameSnake)
  if (propertyNameCamel !== propertyNameSnake) {
    existingItem[propertyNameCamel] = propertyValue
  }
  ctx.assembledItems.set(seedUidForProperty, existingItem)
}

async function processSeeds(ctx: AssembleContext, seeds: AttestationLike[]): Promise<void> {
  const seedUids: string[] = []

  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i]
    if (!seed) continue
    seedUids.push(seed.id)
    const modelType = seed.schema?.schemaNames?.[0]?.name ?? 'unknown'
    ctx.seedUidToModelType.set(seed.id, modelType)

    if (!ctx.assembledItems.has(seed.id)) {
      ctx.assembledItems.set(seed.id, {
        seedUid: seed.id,
        timeCreated: seed.timeCreated,
        attester: seed.attester,
      })
    }
  }

  if (seedUids.length === 0) return

  const itemVersions = await getItemVersionsFromEas({ seedUids })

  for (let i = 0; i < itemVersions.length; i++) {
    const itemVersion = itemVersions[i] as AttestationLike
    const seedUid = itemVersion.refUID
    ctx.versionUidToSeedUid.set(itemVersion.id, seedUid)
    const existingVersions = ctx.versionsBySeedUid.get(seedUid) || []
    ctx.versionsBySeedUid.set(seedUid, [...existingVersions, itemVersion])
  }

  const latestVersionUids: string[] = []
  for (const [seedUid, versions] of ctx.versionsBySeedUid.entries()) {
    if (ctx.latestVersionUidsBySeedUid.has(seedUid)) continue
    const sortedVersions = [...versions].sort((a, b) => b.timeCreated - a.timeCreated)
    const latestVersion = sortedVersions[0]
    if (latestVersion) {
      latestVersionUids.push(latestVersion.id)
      ctx.latestVersionUidsBySeedUid.set(seedUid, latestVersion.id)
    }
  }

  if (latestVersionUids.length === 0) return

  const rawProperties = await getItemPropertiesFromEas({ versionUids: latestVersionUids })
  const itemProperties = pickLatestPropertyAttestationsByRefAndSchema(rawProperties)

  for (let i = 0; i < itemProperties.length; i++) {
    await processItemProperty(ctx, itemProperties[i] as AttestationLike)
  }
}

function resolveRelationPropertiesToUrls(ctx: AssembleContext, schemaName: string): void {
  const itemsToProcess = Array.from(ctx.assembledItems.entries()).filter(
    ([seedUid]) => ctx.seedUidToModelType.get(seedUid) === schemaName,
  )

  for (const [, item] of itemsToProcess) {
    const keysToProcess = Object.keys(item).filter(
      (k) => !k.startsWith('_') && !RESERVED_KEYS.has(k),
    )

    for (const key of keysToProcess) {
      let value = item[key]
      const coerced = tryCoerceJsonStringArray(value)
      if (coerced !== value && Array.isArray(coerced)) {
        item[key] = coerced
        value = coerced
      }
      const isList = Array.isArray(value)

      if (isList) {
        const uids = value as unknown[]
        const hasRelationUid = uids.some(
          (v) =>
            typeof v === 'string' &&
            !relationValuesToExclude.includes(v) &&
            ctx.assembledItems.has(v),
        )
        if (!hasRelationUid) continue

        const urls: string[] = []
        const models: string[] = []
        let resolved = false
        for (const uid of uids) {
          if (typeof uid !== 'string' || relationValuesToExclude.includes(uid)) {
            urls.push(String(uid))
            models.push('unknown')
            continue
          }
          const modelForUid = ctx.seedUidToModelType.get(uid) ?? 'unknown'
          if (modelForUid === IMAGE_SCHEMA) {
            urls.push(uid)
            models.push(IMAGE_SCHEMA)
            continue
          }
          const related = ctx.assembledItems.get(uid)
          const txId = (related?.storageTransactionId ??
            related?.storage_transaction_id) as string | undefined
          if (txId && typeof txId === 'string' && txId.trim()) {
            try {
              urls.push(getArweaveUrlForTransaction(txId))
              models.push(modelForUid)
              resolved = true
            } catch {
              urls.push(uid)
              models.push(modelForUid)
            }
          } else {
            urls.push(uid)
            models.push(modelForUid)
          }
        }
        if (resolved) {
          const outputKey = publicListRelationPropertyKey(key)
          item[outputKey] = urls
          setListElementStorageModels(item, outputKey, models)
          stripListRelationStorageAliasesForPublicKey(item, outputKey)
          if (outputKey !== key) {
            delete item[key]
            const camelKey = toCamelCase(key)
            if (camelKey !== key) delete item[camelKey]
          }
        }
      } else if (typeof value === 'string') {
        if (relationValuesToExclude.includes(value)) continue
        if (!ctx.assembledItems.has(value)) continue

        const related = ctx.assembledItems.get(value)
        if (ctx.seedUidToModelType.get(value) === IMAGE_SCHEMA) {
          continue
        }
        const txId = (related?.storageTransactionId ?? related?.storage_transaction_id) as
          | string
          | undefined
        if (txId && typeof txId === 'string' && txId.trim()) {
          try {
            const outputKey = key.endsWith('_id') ? key.replace(/_id$/, '') : key
            item[outputKey] = getArweaveUrlForTransaction(txId)
            const relatedModel = ctx.seedUidToModelType.get(value) ?? 'unknown'
            setFieldStorageModel(item, outputKey, relatedModel)
            const camelOut = toCamelCase(outputKey)
            if (camelOut !== outputKey) {
              setFieldStorageModel(item, camelOut, relatedModel)
            }
            if (outputKey !== key) {
              delete item[key]
              const camelKey = toCamelCase(key)
              if (camelKey !== key) delete item[camelKey]
            }
          } catch {
            // keep original on error
          }
        }
      }
    }
  }
}

function expandRelationProperties(
  ctx: AssembleContext,
  schemaName: string,
  expandRelations: boolean,
): void {
  if (!expandRelations) return

  const itemsToProcess = Array.from(ctx.assembledItems.entries()).filter(
    ([seedUid]) => ctx.seedUidToModelType.get(seedUid) === schemaName,
  )

  for (const [, item] of itemsToProcess) {
    const keysToProcess = Object.keys(item).filter(
      (k) => !k.startsWith('_') && !RESERVED_KEYS.has(k),
    )

    for (const key of keysToProcess) {
      let value = item[key]
      const coerced = tryCoerceJsonStringArray(value)
      if (coerced !== value && Array.isArray(coerced)) {
        item[key] = coerced
        value = coerced
      }
      const isList = Array.isArray(value)
      const uids = isList ? (value as unknown[]) : [value]

      const expanded: unknown[] = []
      let didExpand = false

      for (const uid of uids) {
        if (typeof uid !== 'string' || relationValuesToExclude.includes(uid)) {
          expanded.push(uid)
          continue
        }
        const related = ctx.assembledItems.get(uid)
        if (!related) {
          expanded.push(uid)
          continue
        }
        const txId = (related?.storageTransactionId ?? related?.storage_transaction_id) as
          | string
          | undefined
        const isImage = ctx.seedUidToModelType.get(uid) === IMAGE_SCHEMA

        if (isImage) {
          const clone = { ...related } as Record<string, unknown>
          ensureSeedIdentity(clone, uid)
          clone.schemaName = IMAGE_SCHEMA
          enrichImageSeedClone(clone)
          expanded.push(clone)
          didExpand = true
          continue
        }

        if (txId && typeof txId === 'string' && txId.trim()) {
          expanded.push(uid)
          continue
        }
        const clone = { ...related } as Record<string, unknown>
        ensureSeedIdentity(clone, uid)
        expanded.push(clone)
        didExpand = true
      }

      if (didExpand) {
        const outputKey = isList
          ? publicListRelationPropertyKey(key)
          : key.endsWith('_id')
            ? key.replace(/_id$/, '')
            : key
        item[outputKey] = isList ? expanded : expanded[0]
        stripListRelationStorageAliasesForPublicKey(item, outputKey)
        if (outputKey !== key) {
          delete item[key]
          const camelKey = toCamelCase(key)
          if (camelKey !== key) delete item[camelKey]
        }
      }
    }
  }
}

function toSeedRecords(
  ctx: AssembleContext,
  schemaName: string,
): SeedRecord[] {
  return Array.from(ctx.assembledItems.entries())
    .filter(([seedUid]) => ctx.seedUidToModelType.get(seedUid) === schemaName)
    .map(([seedUid, item]) => {
      const versionUid = ctx.latestVersionUidsBySeedUid.get(seedUid) ?? ''
      if (versionUid) {
        item.versionUid = versionUid
      }
      ensureSeedIdentity(item, seedUid)
      const timeCreated =
        typeof item.timeCreated === 'number' ? item.timeCreated : 0
      const attester =
        typeof item.attester === 'string'
          ? item.attester
          : typeof item.Attester === 'string'
            ? item.Attester
            : undefined
      return {
        seedUid,
        schemaName,
        attester,
        timeCreated,
        versionUid,
        data: item,
      }
    })
}

/**
 * Assemble canonical SeedRecords from Seed attestations (latest Version + canonical properties).
 * Uses per-call state (safe for concurrent requests).
 */
export async function assembleSeeds(
  schemaName: string,
  seeds: AttestationLike[],
  options?: AssembleOptions,
): Promise<SeedRecord[]> {
  const expandRelations = options?.expandRelations !== false
  const hydrateStorage = options?.hydrateStorage !== false

  const ctx = createAssembleContext()

  await processSeeds(ctx, seeds)

  const relatedSeedUidsArray = Array.from(ctx.relatedSeedUids).filter(
    (uid) => !ctx.assembledItems.has(uid),
  )
  if (relatedSeedUidsArray.length > 0) {
    const easClient = EasClient.getEasClient()
    const { itemSeeds: relatedSeeds } = await easClient.request(GET_SEEDS, {
      where: withExcludeRevokedFilter({
        id: {
          in: relatedSeedUidsArray,
        },
      }),
      take: relatedSeedUidsArray.length || 1,
      skip: 0,
    })
    await processSeeds(ctx, (relatedSeeds ?? []) as AttestationLike[])
  }

  resolveRelationPropertiesToUrls(ctx, schemaName)
  expandRelationProperties(ctx, schemaName, expandRelations)

  const records = toSeedRecords(ctx, schemaName)

  if (hydrateStorage) {
    await hydrateArweaveRichTextInItems(records.map((r) => r.data))
  }

  return records
}
