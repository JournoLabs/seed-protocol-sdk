import { EventObject, fromCallback } from 'xstate'
import { convertTxIdToImageSrc } from '@/shared/helpers'
import { fs } from '@zenfs/core'
import {
  getRelationValueData,
  getStorageTransactionIdForSeedUid,
} from '@/browser/db/read'
import debug from 'debug'
import { FromCallbackInput } from '@/types/machines'
import { PropertyMachineContext } from '@/types/property'

const logger = debug('app:property:actors:resolveRelatedValue')

const storageTransactionIdToContentUrl = new Map<string, string>()
const refResolvedValueToContentUrl = new Map<string, string>()
const seedUidToContentUrl = new Map<string, string>()

export const resolveRelatedValue = fromCallback<
  EventObject,
  FromCallbackInput<PropertyMachineContext, EventObject>
>(({ sendBack, input: { context } }) => {
  const {
    isRelation,
    propertyValue,
    propertyName,
    seedUid,
    propertyRecordSchema,
    populatedFromDb,
    schemaUid,
  } = context

  const _resolveRelatedValue = async () => {
    if (!propertyValue || !isRelation || populatedFromDb) {
      return
    }

    let parsedValue

    try {
      parsedValue = JSON.parse(propertyValue)
    } catch (error) {
      logger(`${propertyName} value is not a JSON string.`)
    }

    if (!parsedValue && seedUidToContentUrl.has(propertyValue)) {
      const contentUrl = seedUidToContentUrl.get(propertyValue)
      sendBack({
        type: 'updateContext',
        renderValue: contentUrl,
      })
      sendBack({
        type: 'resolvingRelatedValueSuccess',
        refResolvedDisplayValue: contentUrl,
      })
      return true
    }

    if (Array.isArray(propertyValue)) {
      // TODO: Handle array of seedUids
      logger(`${propertyName} value is an array of seedUids`)
      return
    }

    if (Array.isArray(parsedValue)) {
      logger(`${propertyName} value is a stringified array of seedUids`)
      return
    }

    const storageTransactionId =
      await getStorageTransactionIdForSeedUid(propertyValue)

    if (storageTransactionId) {
      if (storageTransactionIdToContentUrl.has(storageTransactionId)) {
        const contentUrl =
          storageTransactionIdToContentUrl.get(storageTransactionId)
        sendBack({
          type: 'updateContext',
          renderValue: contentUrl,
        })
        sendBack({
          type: 'resolvingRelatedValueSuccess',
          refResolvedDisplayValue: contentUrl,
          refResolvedValue: storageTransactionId,
        })
        return true
      }

      const contentUrl = await convertTxIdToImageSrc(storageTransactionId)
      if (contentUrl) {
        seedUidToContentUrl.set(propertyValue, contentUrl)
      }
      sendBack({
        type: 'updateContext',
        renderValue: contentUrl,
      })
      sendBack({
        type: 'resolvingRelatedValueSuccess',
        refResolvedDisplayValue: contentUrl,
        refResolvedValue: storageTransactionId,
      })
      return true
    }

    const relationValueData = await getRelationValueData(propertyValue)

    if (relationValueData) {
      const { refResolvedValue } = relationValueData
      const propertyValueFromDb = relationValueData.propertyValue

      // This handles a local-only relation value and resolves from the filesystem
      if (
        refResolvedValue &&
        propertyRecordSchema.dataType === 'Relation' &&
        propertyValueFromDb.length === 10 &&
        propertyRecordSchema.ref
      ) {
        if (refResolvedValueToContentUrl.has(refResolvedValue)) {
          const contentUrl = refResolvedValueToContentUrl.get(refResolvedValue)
          sendBack({
            type: 'updateContext',
            renderValue: contentUrl,
          })
          sendBack({
            type: 'resolvingRelatedValueSuccess',
            refResolvedDisplayValue: contentUrl,
          })
          return true
        }

        const fileExists = await fs.promises.exists(
          '/files/images/' + refResolvedValue,
        )
        if (fileExists) {
          const fileContents = await fs.promises.readFile(
            '/files/images/' + refResolvedValue,
          )
          const fileHandler = new File([fileContents], refResolvedValue)
          const contentUrl = URL.createObjectURL(fileHandler)
          refResolvedValueToContentUrl.set(refResolvedValue, contentUrl)
          sendBack({
            type: 'updateContext',
            renderValue: contentUrl,
          })
          sendBack({
            type: 'resolvingRelatedValueSuccess',
            refResolvedDisplayValue: contentUrl,
          })
          return true
        }
      }

      if (typeof propertyValueFromDb === 'string') {
        // Check files for a filename that matches the propertyValue
        if (
          propertyRecordSchema &&
          propertyRecordSchema.refValueType === 'ImageSrc'
        ) {
          let contentUrl

          if (storageTransactionIdToContentUrl.has(propertyValueFromDb)) {
            contentUrl =
              storageTransactionIdToContentUrl.get(propertyValueFromDb)
          }

          if (!contentUrl) {
            const imageFileExists = await fs.promises.exists(
              `/images/${propertyValue}`,
            )
            if (imageFileExists) {
              const fileContents = await fs.promises.readFile(
                `/images/${propertyValue}`,
              )
              const fileHandler = new File([fileContents], propertyValue)
              contentUrl = URL.createObjectURL(fileHandler)
              storageTransactionIdToContentUrl.set(
                propertyValueFromDb,
                contentUrl,
              )
            }
          }

          if (contentUrl) {
            sendBack({
              type: 'updateContext',
              renderValue: contentUrl,
            })
            sendBack({
              type: 'resolvingRelatedValueSuccess',
              refResolvedDisplayValue: contentUrl,
            })
            return true
          }
        }
      }
    }
  }

  _resolveRelatedValue().then((success) => {
    // if (success) {
    //   sendBack({
    //     type: 'resolvingRelatedValueDone',
    //   })
    // }
    // return
    sendBack({
      type: 'resolvingRelatedValueDone',
    })
  })
})

//   const eventKey = `storage.transaction.${initialValue}.contentUrl.response`
//
//   const contentUrlListener = async (event) => {
//     console.log('[itemProperty] [constructor] contentUrlListener', event)
//   }
//
//   eventEmitter.once(eventKey, contentUrlListener)
//
//   const ready = getArePropertyEventHandlersReady()
//
//   console.log('[itemProperty] [constructor] ready', ready)
//
//   eventEmitter.emit('storage.transaction.contentUrl.request', {
//     storageTransactionId: initialValue,
//   })

// Related property values can either be seedUid or seedUid[]
// let relatedSeedUid: string
// let relatedSeedUids: string[]
//
// if (Array.isArray(propertyValue)) {
//   relatedSeedUids = propertyValue
// } else {
//   relatedSeedUid = propertyValue
// }
//
// if (relatedSeedUid) {
//   console.log(
//     `[property/actors] [resolveRelatedValue] seedUid: ${relatedSeedUid}`,
//   )
//   const latestVersionOfRelatedSeedQuery = await appDb.run(
//     sql.raw(
//       `
//           SELECT local_id, uid, MAX(attestation_created_at)
//           FROM versions
//           WHERE seed_uid = '${relatedSeedUid}';
//       `,
//     ),
//   )
//   if (
//     latestVersionOfRelatedSeedQuery &&
//     latestVersionOfRelatedSeedQuery.rows &&
//     latestVersionOfRelatedSeedQuery.rows.length > 0
//   ) {
//     const latestVersionOfRelatedSeed =
//       latestVersionOfRelatedSeedQuery.rows[0]
//     console.log(
//       '[property/actors] [resolveRelatedValue] latestVersionOfRelatedSeed',
//       latestVersionOfRelatedSeed,
//     )
//     const storageIdQuery = await appDb.run(
//       sql.raw(
//         `
//             SELECT property_value, MAX(attestation_created_at), ref_resolved_display_value, ref_resolved_value
//             FROM metadata
//             WHERE seed_uid = '${relatedSeedUid}'
//               AND property_name = 'storageTransactionId';
//         `,
//       ),
//     )
//
//     if (
//       storageIdQuery &&
//       storageIdQuery.rows &&
//       storageIdQuery.rows.length > 0
//     ) {
//       const storageId = storageIdQuery.rows[0][0]
//
//       if (!storageId) {
//         console.error(
//           `storageId not found for ${propertyName} with relatedSeedUid ${relatedSeedUid}`,
//         )
//       }
//
//       const refResolvedDisplayValue = storageIdQuery.rows[0][2]
//       let resolvedValue = storageIdQuery.rows[0][3]
//
//       if (refResolvedDisplayValue && resolvedValue) {
//         sendBack({
//           type: 'resolvingRelatedValueSuccess',
//           refResolvedDisplayValue,
//           resolvedValue,
//         })
//         return
//       }
//
//       console.log(
//         '[property/actors] [resolveRelatedValue] storageId',
//         storageId,
//       )
//
//       const contentUrl = await convertTxIdToImageSrc(storageId)
//
//       if (!contentUrl) {
//         throw new Error(
//           `contentUrl not found for ${propertyName} with relatedSeedUid ${relatedSeedUid}`,
//         )
//       }
//
//       await appDb.run(
//         sql.raw(
//           `UPDATE metadata
//            SET ref_resolved_display_value = '${contentUrl}',
//                ref_resolved_value         = '${storageId}'
//            WHERE seed_uid = '${relatedSeedUid}'
//              AND property_name = 'storageTransactionId';
//           `,
//         ),
//       )
//
//       sendBack({
//         type: 'resolvingRelatedValueSuccess',
//         refResolvedDisplayValue: contentUrl,
//         resolvedValue: storageId,
//       })
//     }
//   }
//
//   const versionUidQuery = await appDb.run(
//     sql.raw(
//       `
//           SELECT uid
//           FROM versions
//           WHERE seed_uid = '${relatedSeedUid}';
//       `,
//     ),
//   )
//
//   if (
//     versionUidQuery &&
//     versionUidQuery.rows &&
//     versionUidQuery.rows.length > 0
//   ) {
//     const versionUids = versionUidQuery.rows.map((row) => row[0])
//     console.log(
//       '[property/actors] [resolveRelatedValue] versionUids',
//       versionUids,
//     )
//     const { itemProperties } = await easClient.request(GET_PROPERTIES, {
//       where: {
//         refUID: {
//           in: versionUids,
//         },
//         decodedDataJson: {
//           contains: 'storage_transaction_id',
//         },
//       },
//     })
//
//     console.log(
//       '[property/actors] [resolveRelatedValue] itemProperties',
//       itemProperties,
//     )
//
//     if (itemProperties && itemProperties.length > 0) {
//       await savePropertiesToDb(itemProperties)
//     }
//   }
// }