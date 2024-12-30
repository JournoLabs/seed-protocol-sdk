import { camelCase, DebouncedFunc, startCase, throttle } from 'lodash-es'
import { Attestation, SchemaWhereInput } from '@/browser/gql/graphql'
import {
  metadata,
  MetadataType,
  modelUids,
  properties,
  propertyUids,
  seeds,
  SeedType,
  versions,
} from '@/shared/seedSchema'
import { and, eq, inArray, sql } from 'drizzle-orm'
import {
  generateId,
  parseEasRelationPropertyName,
  toSnakeCase,
} from '@/shared/helpers'
import { easClient, queryClient } from '@/browser/helpers'
import {
  GET_PROPERTIES,
  GET_SCHEMAS,
  GET_SEEDS,
  GET_VERSIONS,
} from '@/browser/item/queries'
import { INTERNAL_DATA_TYPES } from '@/shared/helpers/constants'
import { escapeSqliteString, getAddressesFromDb } from '@/shared/helpers/db'
import { eventEmitter } from '@/eventBus'
import { getModelNames, getModels } from '@/browser/stores/modelClass'
import { getAppDb } from '@/browser/db/sqlWasmClient'
import { getModelSchemas } from '@/browser/db/read/getModelSchemas'
import debug from 'debug'
import { ModelSchema, PropertyType } from '@/types'
import { createSeeds } from '@/browser/db/write/createSeeds'
import { setSchemaUidForSchemaDefinition } from '@/browser/stores/eas'

const logger = debug('app:item:events:syncDbWithEas')

const relationValuesToExclude = [
  '0x0000000000000000000000000000000000000000000000000000000000000020',
]

const processPropertiesFoundInDb = async ({ foundModel }) => {
  const appDb = getAppDb()

  const foundPropertiesDb = await appDb
    .select({
      id: properties.id,
      name: properties.name,
      dataType: properties.dataType,
      uid: propertyUids.uid,
    })
    .from(properties)
    .fullJoin(propertyUids, eq(properties.id, propertyUids.propertyId))
    .where(eq(properties.modelId, foundModel.id))

  if (!foundPropertiesDb || foundPropertiesDb.length === 0) {
    return
  }

  if (foundPropertiesDb && foundPropertiesDb.length > 0) {
    const queryVariables: { where: SchemaWhereInput } = {
      where: {
        OR: [],
      },
    }

    for (const foundPropertyDb of foundPropertiesDb) {
      if (foundPropertyDb.name && foundPropertyDb.dataType) {
        const easDatatype = INTERNAL_DATA_TYPES[foundPropertyDb.dataType].eas

        let easPropertyName = toSnakeCase(foundPropertyDb.name)

        if (foundPropertyDb.dataType === 'Relation') {
          easPropertyName += '_id'
        }

        queryVariables.where.OR!.push({
          schema: {
            equals: `${easDatatype} ${easPropertyName}`,
          },
        })
      }
    }

    const modelName = foundModel.name

    const foundPropertySchemas = await queryClient.fetchQuery({
      queryKey: [`getPropertySchemas${modelName}`],
      queryFn: async () => easClient.request(GET_SCHEMAS, queryVariables),
    })

    const tempExclusions = ['html', 'json']

    for (const foundProperty of foundPropertiesDb) {
      if (tempExclusions.includes(foundProperty.name)) {
        continue
      }
      const easDatatype = INTERNAL_DATA_TYPES[foundProperty.dataType].eas

      let easPropertyName = toSnakeCase(foundProperty.name)

      if (foundProperty.dataType === 'Relation') {
        easPropertyName += '_id'
      }

      const regex = new RegExp(`${easDatatype} ${easPropertyName}`)
      const propertySchema = foundPropertySchemas.schemas.find((s) =>
        regex.test(s.schema),
      )

      if (!propertySchema) {
        // TODO: We should create the schema here?
        continue
      }
      await appDb
        .insert(propertyUids)
        .values({
          propertyId: foundProperty.id,
          uid: propertySchema.id,
        })
        .onConflictDoNothing()
    }
  }
}

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
  const appDb = getAppDb()

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
) => Promise<Record<string, unknown>>

const saveEasVersionsToDb: SaveEasVersionsToDb = async ({ itemVersions }) => {
  const versionUids = itemVersions.map((version) => version.id)

  const appDb = getAppDb()

  const existingVersionRecordsRows: MetadataType[] = await appDb
    .select()
    .from(versions)
    .where(inArray(versions.uid, versionUids))

  const existingVersionUids = new Set<string>()

  if (existingVersionRecordsRows && existingVersionRecordsRows.length > 0) {
    for (const row of existingVersionRecordsRows) {
      existingVersionUids.add(row.uid)
      versionUidToLocalId.set(row.uid, row.localId)
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

  const appDb = getAppDb()

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

  const appDb = getAppDb()

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
    const appDb = getAppDb()

    const { modelSchemas, schemaStringToModelRecord } = await getModelSchemas()

    if (
      !modelSchemas ||
      !modelSchemas.schemas ||
      modelSchemas.schemas.length === 0
    ) {
      throw new Error(`No schemas found for models`)
    }

    const schemaUids: string[] = []

    for (const modelSchema of modelSchemas.schemas) {
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

      await processPropertiesFoundInDb({
        foundModel,
      })
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

    const { itemVersions } = await queryClient.fetchQuery({
      queryKey: [`getVersionsForAllModels`],
      queryFn: async () =>
        easClient.request(GET_VERSIONS, {
          where: {
            refUID: {
              in: seedUids,
            },
          },
        }),
    })

    const { versionUids } = await saveEasVersionsToDb({
      itemVersions,
    })

    const { itemProperties } = await queryClient.fetchQuery({
      queryKey: [`getPropertiesForAllModels`],
      queryFn: async () =>
        easClient.request(GET_PROPERTIES, {
          where: {
            refUID: {
              in: versionUids,
            },
          },
        }),
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
