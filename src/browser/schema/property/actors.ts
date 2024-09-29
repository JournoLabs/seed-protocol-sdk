import { EventObject, fromCallback } from 'xstate'
import { propertyMachine } from '@/browser/schema/property/machine'
import { getDb } from '@/browser/services/db/actors'
import {
  DB_NAME_APP,
  DB_NAME_SDK_CONFIG,
} from '@/browser/services/internal/constants'
import pluralize from 'pluralize'
import { sql } from 'drizzle-orm'

export const waitForDb = fromCallback<EventObject, typeof propertyMachine>(
  ({ sendBack }) => {
    const _waitForDb = new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        const appDb = getDb(DB_NAME_APP)
        const sdkConfigDb = getDb(DB_NAME_SDK_CONFIG)

        if (appDb || !sdkConfigDb) {
          clearInterval(interval)
          resolve()
        }
      }, 100)
    })

    _waitForDb.then(() => {
      sendBack({ type: 'waitForDbSuccess' })
    })
  },
)

export const initialize = fromCallback<EventObject, typeof propertyMachine>(
  ({ sendBack, input: { context } }) => {
    const { isRelation } = context

    if (isRelation) {
      sendBack({ type: 'isRelatedProperty' })
    }

    if (!isRelation) {
      sendBack({ type: 'initializeSuccess' })
    }
  },
)

export const resolveRelatedValue = fromCallback<
  EventObject,
  typeof propertyMachine
>(({ sendBack, input: { context } }) => {
  const {
    isRelation,
    propertyRecordSchema,
    propertyValue,
    itemModelName,
    propertyName,
    seedLocalId,
    seedUid,
  } = context

  const sdkConfigDb = getDb(DB_NAME_SDK_CONFIG)
  const appDb = getDb(DB_NAME_APP)

  if (!sdkConfigDb) {
    throw new Error('initialize: sdkConfigDb is undefined')
  }

  if (!appDb) {
    throw new Error('initialize: appDb is undefined')
  }

  const modelNamePlural = pluralize(itemModelName)
  const modelTableName = modelNamePlural.toLowerCase()
  const propertiesTableName = modelTableName + '_data'

  // console.log(
  //   `[property/actors] [resolveRelatedValue] \nitemModelName: ${itemModelName} \npropertyName: ${propertyName} \nisRelation: ${isRelation}`,
  // )

  const _resolveRelatedValue = async () => {
    if (!propertyValue || !isRelation) {
      return
    }

    // Related property values can either be seedUid or seedUid[]
    let relatedSeedUid: string
    let relatedSeedUids: string[]

    if (Array.isArray(propertyValue)) {
      relatedSeedUids = propertyValue
    } else {
      relatedSeedUid = propertyValue
    }

    if (relatedSeedUid) {
      console.log(
        `[property/actors] [resolveRelatedValue] seedUid: ${relatedSeedUid}`,
      )
      const latestVersionOfRelatedSeedQuery = await appDb.run(
        sql.raw(
          `
              SELECT local_id, uid, MAX(attestation_created_at)
              FROM versions
              WHERE seed_uid = '${relatedSeedUid}';
          `,
        ),
      )
      if (
        latestVersionOfRelatedSeedQuery &&
        latestVersionOfRelatedSeedQuery.rows &&
        latestVersionOfRelatedSeedQuery.rows.length > 0
      ) {
        const latestVersionOfRelatedSeed =
          latestVersionOfRelatedSeedQuery.rows[0]
      }
    }

    if (relatedSeedUids) {
      console.log(
        `[property/actors] [resolveRelatedValue] seedUids: ${relatedSeedUids}`,
      )
    }

    // const latestRecordsQuery = await appDb.run(
    //   sql.raw(
    //     `
    //         SELECT property_value, seed_uid, seed_local_id, version_local_id, version_uid, MAX(attestation_created_at)
    //         FROM ${propertiesTableName}
    //         WHERE property_name = '${propertyName}'
    //           AND version_local_id = '${versionLocalId}'
    //         GROUP BY seed_local_id;
    //     `,
    //   ),
    // )

    // if (
    //   latestRecordsQuery &&
    //   latestRecordsQuery.rows &&
    //   latestRecordsQuery.rows.length > 0
    // ) {
    //   for (const recordValues of latestRecordsQuery.rows) {
    //     console.log(
    //       '[property/actors] [resolveRelatedValue] recordValues',
    //       recordValues,
    //     )
    //   }
    // }

    // const relatedModelQuery = await sdkConfigDb
    //   .select({
    //     id: modelsTable.id,
    //     name: modelsTable.name,
    //     uid: modelUids.uid,
    //   })
    //   .from(modelsTable)
    //   .leftJoin(modelUids, eq(modelsTable.id, modelUids.modelId))
    //   .where(eq(modelsTable.id, propertyRecordSchema.refModelId))
    //   .limit(1)
    //
    // const relatedModel = relatedModelQuery[0]
    // const relationValueType = propertyRecordSchema.refValueType

    const eventId = `item.${itemModelName}.propertyValuesForSeedUid.response`

    const relatedValuesForSeedListener = async (event) => {
      const { propertyAttestations, seedUid } = event
      if (seedUid !== propertyValue) {
        return
      }
      // Here the propertyValue represents the seedUid of the related Seed
      // To get the value, we need to find the latest version of the related Seed
      // and then get the value from propertyAttestation that matches the resValueType

      // for (const attestation of propertyAttestations) {
      //   const relatedVersionId = attestation.refUID
      //   const attestationValue = JSON.parse(attestation.decodedDataJson)
      //   if (
      //     propertyRecordSchema.refValueType === 'ImageSrc' &&
      //     attestationValue[0].value.name === 'storage_transaction_id'
      //   ) {
      //     const refResolvedValue = attestationValue[0].value.value
      //     const easDataType = attestationValue[0].value.type
      //
      //     let contentUrl = getTxIdToContentUrl(refResolvedValue)
      //
      //     if (!contentUrl) {
      //       console.log(
      //         `[property/actors] [resolveRelatedValue] ${itemModelName}.${propertyName} calling convertTxId`,
      //         refResolvedValue,
      //       )
      //       contentUrl = await convertTxIdToImageSrc(refResolvedValue)
      //       setTxIdToContentUrl(refResolvedValue, contentUrl!)
      //     }
      //
      //     await appDb.run(
      //       sql.raw(
      //         `UPDATE ${propertiesTableName}
      //          SET ref_resolved_value         = '${refResolvedValue}',
      //              ref_resolved_display_value = '${contentUrl}',
      //              ref_value_type             = '${propertyRecordSchema.refValueType}',
      //              ref_model_uid              = '${relatedModel.uid}',
      //              eas_data_type              = '${easDataType}'
      //          WHERE ref_version_uid = '${relatedVersionId}';`,
      //       ),
      //     )
      //
      //     sendBack({
      //       type: 'resolvingRelatedValueSuccess',
      //       propertyRelationDisplayValue: contentUrl,
      //       propertyRelationValue: refResolvedValue,
      //     })
      //
      //     eventEmitter.emit('item.propertyValuesForSeedUid.request', {
      //       modelName: itemModelName,
      //       seedUid,
      //     })
      //   }
      // }
      // eventEmitter.removeListener(eventId, relatedValuesForSeedListener)
    }
    //
    // eventEmitter.addListener(eventId, relatedValuesForSeedListener)
    //
    // eventEmitter.emit('item.propertyValuesForSeedUid.request', {
    //   modelName: itemModelName,
    //   seedUid: propertyValue,
    // })
  }

  _resolveRelatedValue()
    .then((value) => {
      sendBack({ type: 'fetchSuccess', fetchedValue: propertyValue })
    })
    .catch((error) => {
      console.log('[property/actors] [resolveRelatedValue] error', error)
      sendBack({ type: 'fetchFailure', error })
    })
})
