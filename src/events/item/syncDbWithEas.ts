import { camelCase, DebouncedFunc, startCase, throttle } from 'lodash-es'
import { Attestation, SchemaWhereInput } from '@/graphql/gql/graphql'
import {
  metadata,
  MetadataType,
  modelUids,
  seeds,
  SeedType,
  versions,
} from '@/seedSchema'
import { and, eq, inArray, sql } from 'drizzle-orm'
import {
  generateId,
  parseEasRelationPropertyName,
} from '@/helpers'
import {
  GET_PROPERTIES,
  GET_SEEDS,
  GET_VERSIONS,
} from '@/Item/queries'
import { escapeSqliteString, getAddressesFromDb } from '@/helpers/db'
import { eventEmitter } from '@/eventBus'
import { getModelNames, getModels } from '@/stores/modelClass'
import { BaseDb } from '@/db/Db/BaseDb'
import { getModelSchemas } from '@/db/read/getModelSchemas'
import { ModelSchema, PropertyType } from '@/types'
import { createSeeds } from '@/db/write/createSeeds'
import { setSchemaUidForSchemaDefinition } from '@/stores/eas'
import { BaseEasClient } from '@/helpers/EasClient/BaseEasClient'
import { BaseQueryClient } from '@/helpers/QueryClient/BaseQueryClient'
import { getItemPropertiesFromEas, getItemVersionsFromEas, getModelSchemasFromEas } from '@/browser/helpers/eas'


const relationValuesToExclude = [
  '0x0000000000000000000000000000000000000000000000000000000000000020',
]


const getSeedsFromSchemaUids = async ({ schemaUids, addresses }) => {
  const AND = [
    {
      OR: [] as Record<string, unknown>[],
    },
  ]

  for (const schemaUid of schemaUids) {
    AND[0].OR.push({
      decodedDataJson: {
        contains: schemaUid,
      },
    })
  }

  const queryClient = BaseQueryClient.getQueryClient()
  const easClient = BaseEasClient.getEasClient()

  const { itemSeeds } = await queryClient.fetchQuery({
    queryKey: [`getSeedsForAllModels`],
    queryFn: async () =>
      easClient.request(GET_SEEDS, {
        where: {
          attester: {
            in: addresses,
          },
          schemaId: {
            in: schemaUids,
          },
          AND,
        },
      }),
  })

  return itemSeeds
}

const seedUidToLocalId = new Map<string, string>()
const seedUidToModelType = new Map<string, string>()
const relatedSeedUids = new Set<string>()

const versionUidToLocalId = new Map<string, string>()
const versionUidToSeedUid = new Map<string, string>()

const propertyUidToLocalId = new Map<string, string>()

type SaveEasSeedsToDbProps = {
  itemSeeds: Attestation[]
}

type SaveEasSeedsToDbReturn = {
  seedUids: string[]
}

type SaveEasSeedsToDb = (
  props: SaveEasSeedsToDbProps,
) => Promise<SaveEasSeedsToDbReturn>

const saveEasSeedsToDb: SaveEasSeedsToDb = async ({ itemSeeds }) => {
  const appDb = BaseDb.getAppDb()

  const seedUids = itemSeeds.map((seed) => seed.id)

  const existingSeedRecordsRows: SeedType[] = await appDb
    .select()
    .from(seeds)
    .where(inArray(seeds.uid, seedUids))

  const existingSeedUids = new Set<string>()

  if (existingSeedRecordsRows && existingSeedRecordsRows.length > 0) {
    for (const row of existingSeedRecordsRows) {
      existingSeedUids.add(row.uid)
      seedUidToLocalId.set(row.uid, row.localId)
      seedUidToModelType.set(row.uid, row.type)
    }
  }

  const newSeeds = itemSeeds.filter((seed) => !existingSeedUids.has(seed.id))

  if (newSeeds.length === 0) {
    return { seedUidToLocalId, seedUids }
  }

  const newSeedsData: Partial<SeedType>[] = []

  for (let i = 0; i < newSeeds.length; i++) {
    const seed = newSeeds[i]
    seedUidToModelType.set(seed.id, seed.schema.schemaNames[0].name)
    const seedLocalId = generateId()
    seedUidToLocalId.set(seed.id, seedLocalId)

    const attestationRaw = escapeSqliteString(JSON.stringify(seed))

    newSeedsData.push({
      localId: seedLocalId,
      uid: seed.id,
      schemaUid: seed.schemaId,
      type: seed.schema.schemaNames[0].name,
      createdAt: Date.now(),
      attestationCreatedAt: seed.timeCreated * 1000,
      attestationRaw,
    })

    seedUidToLocalId.set(seed.id, seedLocalId)
  }

  const newSeedUids = await createSeeds(newSeedsData)

  return { seedUids: newSeedUids }
}

type SaveEasVersionsToDbParams = {
  itemVersions: Attestation[]
}

type SaveEasVersionsToDb = (
  props: SaveEasVersionsToDbParams,
) => Promise<SaveEasVersionsToDbReturn>

type SaveEasVersionsToDbReturn = {
  versionUids: string[]
}

const saveEasVersionsToDb: SaveEasVersionsToDb = async ({ itemVersions }) => {
  const versionUids = itemVersions.map((version) => version.id)

  const appDb = BaseDb.getAppDb()

  const existingVersionRecordsRows: MetadataType[] = await appDb
    .select()
    .from(versions)
    .where(inArray(versions.uid, versionUids))

  const existingVersionUids = new Set<string>()

  if (existingVersionRecordsRows && existingVersionRecordsRows.length > 0) {
    for (const row of existingVersionRecordsRows) {
      existingVersionUids.add(row.uid)
      versionUidToLocalId.set(row.uid, row.localId)
      versionUidToSeedUid.set(row.uid, row.seedUid)
    }
  }

  const newVersions = itemVersions.filter(
    (version) => !existingVersionUids.has(version.id),
  )

  if (newVersions.length === 0) {
    return { versionUidToLocalId, versionUids }
  }

  let insertVersionsQuery = `INSERT INTO versions (local_id, uid, seed_uid, seed_local_id, seed_type, created_at,
                                                   attestation_created_at,
                                                   attestation_raw)
  VALUES `

  for (let i = 0; i < newVersions.length; i++) {
    const version = newVersions[i]
    versionUidToSeedUid.set(version.id, version.refUID)
    const versionLocalId = generateId()
    versionUidToLocalId.set(version.id, versionLocalId)

    const seedUid = versionUidToSeedUid.get(version.id)
    const seedLocalId = seedUidToLocalId.get(seedUid!)
    const seedType = seedUidToModelType.get(seedUid!)
    const attestationRaw = escapeSqliteString(JSON.stringify(version))

    const valuesString = `('${versionLocalId}', '${version.id}', '${seedUid}', '${seedLocalId}', '${seedType}', ${Date.now()}, ${version.timeCreated * 1000}, '${attestationRaw}')`

    if (i < newVersions.length - 1) {
      insertVersionsQuery += valuesString + ', '
    }

    if (i === newVersions.length - 1) {
      insertVersionsQuery += valuesString + ';'
    }

    versionUidToLocalId.set(version.id, versionLocalId)
  }

  await appDb.run(sql.raw(insertVersionsQuery))

  return { versionUids }
}

const createMetadataRecordsForStorageTransactionId = async (
  storageTransactionIdProperty: Attestation,
  modelSchema: ModelSchema,
) => {
  const attestationData = JSON.parse(
    storageTransactionIdProperty.decodedDataJson,
  )[0].value
  const propertyName = camelCase(attestationData.name)
  const propertyValue = attestationData.value

  const itemStorageProperties = new Map<string, PropertyType>()

  for (const [_propertyName, propertyDef] of Object.entries(modelSchema)) {
    if (propertyDef?.storageType && propertyDef.storageType === 'ItemStorage') {
      itemStorageProperties.set(_propertyName, propertyDef)
    }
  }

  if (itemStorageProperties.size === 0) {
    return
  }

  const appDb = BaseDb.getAppDb()

  for (const [_propertyName, propertyDef] of itemStorageProperties.entries()) {
    const existingMetadataRecordRows = await appDb
      .select()
      .from(metadata)
      .where(
        and(
          eq(metadata.propertyName, _propertyName),
          eq(metadata.propertyValue, propertyValue),
          eq(metadata.versionUid, storageTransactionIdProperty.refUID),
        ),
      )

    if (existingMetadataRecordRows && existingMetadataRecordRows.length > 0) {
      continue
    }

    const seedUid = versionUidToSeedUid.get(
      storageTransactionIdProperty.refUID,
    ) as string
    const seedLocalId = seedUidToLocalId.get(seedUid)
    const versionUid = storageTransactionIdProperty.refUID
    const versionLocalId = versionUidToLocalId.get(versionUid)

    const propertyLocalId = generateId()
    await appDb.insert(metadata).values({
      localId: propertyLocalId,
      propertyName: _propertyName,
      propertyValue,
      localStorageDir: propertyDef.localStorageDir,
      seedLocalId,
      seedUid,
      versionLocalId,
      versionUid,
      refValueType: 'file',
      refResolvedValue: `${propertyValue}${propertyDef.filenameSuffix}`,
      modelType: seedUidToModelType.get(seedUid),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  }
}

type SaveEasPropertiesToDbParams = {
  itemProperties: Attestation[]
  itemSeeds: Attestation[]
}

type SaveEasPropertiesToDb = (
  props: SaveEasPropertiesToDbParams,
) => Promise<Record<string, unknown>>

let isSavingToDb = false

const saveEasPropertiesToDb: SaveEasPropertiesToDb = async ({
  itemProperties,
  itemSeeds,
}) => {
  if (isSavingToDb) {
    return
  }
  isSavingToDb = true

  const propertyUids = itemProperties.map((property) => property.id)

  const models = getModels()

  const appDb = BaseDb.getAppDb()

  const existingMetadataRecordsRows: MetadataType[] = await appDb
    .select()
    .from(metadata)
    .where(inArray(metadata.uid, propertyUids))

  const existingPropertyRecordsUids = new Set<string>()

  if (existingMetadataRecordsRows && existingMetadataRecordsRows.length > 0) {
    for (const row of existingMetadataRecordsRows) {
      existingPropertyRecordsUids.add(row.uid)
      propertyUidToLocalId.set(row.uid, row.localId)
    }
  }

  const newProperties = itemProperties.filter(
    (property) => !existingPropertyRecordsUids.has(property.id),
  )

  if (newProperties.length === 0) {
    return { propertyUidToLocalId, propertyUids }
  }

  let insertPropertiesQuery = `INSERT INTO metadata (local_id, uid, schema_uid, property_name, property_value,
                                                     eas_data_type, version_uid, version_local_id, seed_uid,
                                                     seed_local_id, model_type, ref_value_type, ref_seed_type,
                                                     ref_schema_uid,
                                                     created_at, attestation_created_at, attestation_raw,
                                                     local_storage_dir, ref_resolved_value)
  VALUES `

  for (let i = 0; i < newProperties.length; i++) {
    const property = newProperties[i]
    const propertyLocalId = generateId()
    const metadata = JSON.parse(property.decodedDataJson)[0].value

    let propertyNameSnake = metadata.name

    if (!propertyNameSnake) {
      console.warn(
        '[item/events] [syncDbWithEas] no propertyName found for property: ',
        property,
      )
      continue
    }

    let isRelation = false
    let refValueType
    let refSeedType
    let refSchemaUid
    let refResolvedValue
    let isList = false
    const schemaUid = property.schemaId

    setSchemaUidForSchemaDefinition({
      text: propertyNameSnake,
      schemaUid,
    })

    if (
      (propertyNameSnake.endsWith('_id') ||
        propertyNameSnake.endsWith('_ids')) &&
      propertyNameSnake !== 'storage_transaction_id' &&
      propertyNameSnake !== 'storage_provider_transaction_id'
    ) {
      isRelation = true

      if (Array.isArray(metadata.value)) {
        isList = true
        refValueType = 'list'

        const result = parseEasRelationPropertyName(propertyNameSnake)

        if (result) {
          propertyNameSnake = result.propertyName
          refSeedType = result.modelName
        }

        metadata.value.forEach((value) => {
          relatedSeedUids.add(value)
        })
      }

      if (!isList) {
        if (relationValuesToExclude.includes(metadata.value)) {
          continue
        }
        relatedSeedUids.add(metadata.value)
      }
    }

    let propertyValue = metadata.value

    if (typeof propertyValue !== 'string') {
      propertyValue = JSON.stringify(propertyValue)
    }

    if (isRelation && !isList) {
      const relatedSeed = itemSeeds.find(
        (seed: Attestation) => seed.id === metadata.value,
      )
      if (relatedSeed && relatedSeed.schema && relatedSeed.schema.schemaNames) {
        refSeedType = relatedSeed.schema.schemaNames[0].name
        refSchemaUid = relatedSeed.schemaId
      }
    }

    if (isRelation && isList) {
      const relatedSeeds = itemSeeds.filter((seed: Attestation) =>
        metadata.value.includes(seed.id),
      )
      if (relatedSeeds && relatedSeeds.length > 0) {
        refSeedType = relatedSeeds[0].schema.schemaNames[0].name
        refSchemaUid = relatedSeeds[0].schemaId
      }
    }

    const propertyName = camelCase(propertyNameSnake)
    propertyValue = escapeSqliteString(propertyValue)
    const easDataType = metadata.type
    const versionUid = property.refUID
    const versionLocalId = versionUidToLocalId.get(versionUid)
    const attestationCreatedAt = property.timeCreated * 1000
    const attestationRaw = escapeSqliteString(JSON.stringify(property))
    const seedUid = versionUidToSeedUid.get(versionUid)
    const seedLocalId = seedUidToLocalId.get(seedUid!)
    const modelType = seedUidToModelType.get(seedUid!)

    let localStorageDir
    const modelName = startCase(modelType)
    const ModelClass = models[modelName]
    const modelSchema = ModelClass.schema

    if (propertyNameSnake === 'storage_transaction_id') {
      await createMetadataRecordsForStorageTransactionId(property, modelSchema)
    }

    const valuesString = `('${propertyLocalId}', '${property.id}', 
                         '${property.schemaId}', '${propertyName}', 
                         '${propertyValue}', '${easDataType}', '${versionUid}', 
                         '${versionLocalId}', '${seedUid}', '${seedLocalId}', 
                         '${modelType}', ${refValueType ? `'${refValueType}'` : 'NULL'}, 
                         ${refSeedType ? `'${refSeedType}'` : 'NULL'},
                         ${refSchemaUid ? `'${refSchemaUid}'` : 'NULL'},
                         ${Date.now()}, ${attestationCreatedAt}, '${attestationRaw}',
                         ${localStorageDir ? `'${localStorageDir}'` : 'NULL'},
                         ${refResolvedValue ? `'${refResolvedValue}'` : 'NULL'})`

    if (i < newProperties.length - 1) {
      insertPropertiesQuery += valuesString + ', '
    }

    if (i === newProperties.length - 1) {
      insertPropertiesQuery += valuesString + ';'
    }

    propertyUidToLocalId.set(property.id, propertyLocalId)
  }

  if (insertPropertiesQuery.endsWith('VALUES ')) {
    return { propertyUids }
  }

  if (insertPropertiesQuery.endsWith(', ')) {
    insertPropertiesQuery = insertPropertiesQuery.slice(0, -2) + ';'
  }

  await appDb.run(sql.raw(insertPropertiesQuery))

  isSavingToDb = false

  return { propertyUids }
}

const getRelatedSeedsAndVersions = async () => {
  const queryClient = BaseQueryClient.getQueryClient()
  const easClient = BaseEasClient.getEasClient()

  const { itemSeeds } = await easClient.request(GET_SEEDS, {
    where: {
      id: {
        in: Array.from(relatedSeedUids),
      },
    },
  })

  await saveEasSeedsToDb({ itemSeeds })

  const { itemVersions } = await easClient.request(GET_VERSIONS, {
    where: {
      refUID: {
        in: Array.from(relatedSeedUids),
      },
    },
  })

  await saveEasVersionsToDb({ itemVersions })

  const relatedVersionUids = itemVersions.map((v) => v.id)

  const { itemProperties } = await easClient.request(GET_PROPERTIES, {
    where: {
      refUID: {
        in: relatedVersionUids,
      },
    },
  })

  await saveEasPropertiesToDb({
    itemProperties,
    itemSeeds,
  })
}

const syncDbWithEasHandler: DebouncedFunc<any> = throttle(
  async (_) => {
    const appDb = BaseDb.getAppDb()

    const { schemaStringToModelRecord } = await getModelSchemas()

    const modelSchemas = await getModelSchemasFromEas()

    const schemaUids: string[] = []

    for (const modelSchema of modelSchemas) {
      const foundModel = schemaStringToModelRecord.get(modelSchema.schema)

      if (!foundModel) {
        throw new Error(`Model not found for schema ${modelSchema.schema}`)
      }

      schemaUids.push(modelSchema.id)

      await appDb
        .insert(modelUids)
        .values({
          modelId: foundModel.id,
          uid: modelSchema.id,
        })
        .onConflictDoNothing()

    }

    const addresses = await getAddressesFromDb()

    const itemSeeds = await getSeedsFromSchemaUids({
      schemaUids: schemaUids,
      addresses,
    })

    // const seedDbRecords = new Map<string, Record<string, unknown>>()

    const { seedUids } = await saveEasSeedsToDb({
      itemSeeds,
    })

    const itemVersions = await getItemVersionsFromEas({
      seedUids
    })

    const { versionUids } = await saveEasVersionsToDb({
      itemVersions,
    })

    const itemProperties = await getItemPropertiesFromEas({
      versionUids,
    })

    const { propertyUids } = saveEasPropertiesToDb({
      itemProperties,
      itemSeeds,
    })

    await getRelatedSeedsAndVersions()

    for (const modelName of getModelNames()) {
      eventEmitter.emit('item.requestAll', { modelName })
    }
  },
  30000,
  {
    leading: true,
    trailing: false,
  },
)

export { syncDbWithEasHandler }
