// import { ModelInstance, }                        from '~/models'
// import { CommonValues, ModelName, PreSeedData, } from '~/types/types'
// import { db, ModelProperty, PublishItemData, }   from '~/db'
// import { camelCase, }                            from 'lodash-es'
// import { getModelNameLowercase, }                from '~/helpers'
// import { ZERO_BYTES32, }                         from '@ethereum-attestation-service/eas-sdk'
// import { fromPromise, }                          from 'xstate'
// import { getModelInstance, getPublishAttempt, }  from './helpers'
//
// export const getSeedsToCreate = async ( modelInstance: ModelInstance<CommonValues>, ): Promise<PublishItemData[]> => {
//   const seedsToCreate: PublishItemData[] = []
//
//   if ( modelInstance.seedId!.length === 10 ) {
//
//     // const modelNameLowercase = getModelNameLowercase(modelInstance.modelName,)
//
//     //   seedsToCreate.push({
//     //     modelName         : modelNameLowercase,
//     //     propertySchemaUid : ZERO_BYTES32,
//     //     seedSchemaUid     : modelInstance.schemaUid,
//     //     idProperty        : modelNameLowercase + 'Id',
//     //     seedLocalId       : modelInstance.seedId!,
//     //     seedUid           : ZERO_BYTES32,
//     //     seedTableName     : modelInstance.seedTableName,
//     //     versionTableName  : modelInstance.versionTableName,
//     //   },)
//   }
//
//   const model = await db.models.where({ name : modelInstance.modelName, },).first()
//
//   if ( !model ) {
//     throw new Error(`Model not found for ${modelInstance.modelName}`,)
//   }
//
//   const modelProperties = await db.modelProperties.filter(
//     ( property, ) => {
//       if ( property.modelSchemaUids && model.schemaUid ) {
//         return property.modelSchemaUids.includes(model.schemaUid,)
//       }
//       return false
//     },
//   ).toArray()
//
//   // Check for related properties
//   const relatedProperties = modelProperties.filter(
//     ( property: ModelProperty, ) => Object.hasOwn(property, 'relatedModelSchemaUid',) && !!property.relatedModelSchemaUid,
//   )
//
//   for ( const relatedProperty of relatedProperties ) {
//
//     const relatedPropertyName: string = camelCase(relatedProperty.name,)
//
//     const relatedSeedId = modelInstance.values[relatedPropertyName as keyof ModelInstance<CommonValues>]
//
//     const isList = relatedProperty.name.endsWith('_ids',) || Array.isArray(relatedSeedId,)
//
//     if ( !relatedSeedId || relatedSeedId.length > 10 ) {
//       continue
//     }
//
//     const relatedModel = await db.models.where({ schemaUid : relatedProperty.relatedModelSchemaUid, },).first()
//     if ( !relatedModel ) {
//       throw new Error(`Related model not found for relatedModelSchemaUid ${relatedProperty.relatedModelSchemaUid} for property ${relatedPropertyName} on ${modelInstance.modelName} ${modelInstance.seedId}`,)
//     }
//
//     const relatedModelLowercase = getModelNameLowercase(relatedModel.name as ModelName,)
//
//     if ( !isList ) {
//       seedsToCreate.push({
//         modelName         : relatedModelLowercase,
//         propertySchemaUid : relatedProperty.schemaUid,
//         seedSchemaUid     : relatedProperty.relatedModelSchemaUid,
//         idProperty        : relatedModelLowercase + 'Id',
//         seedLocalId       : relatedSeedId,
//         seedUid           : ZERO_BYTES32,
//         seedTableName     : relatedModelLowercase + 'Seeds',
//         versionTableName  : relatedModelLowercase + 'Versions',
//       },)
//     }
//
//     if ( isList ) {
//       for ( const seedId of relatedSeedId as string[] ) {
//         if ( !seedId || seedId.length > 10 ) {
//           continue
//         }
//         seedsToCreate.push({
//           modelName         : relatedModel.name,
//           propertySchemaUid : relatedProperty.schemaUid,
//           seedSchemaUid     : relatedProperty.relatedModelSchemaUid,
//           idProperty        : camelCase(relatedProperty.name,),
//           seedLocalId       : seedId,
//           seedUid           : undefined,
//           seedTableName     : relatedModelLowercase + 'Seeds',
//           versionTableName  : relatedModelLowercase + 'Versions',
//         },)
//       }
//     }
//
//   }
//
//   return seedsToCreate
// }
//
// export const getSeeds = fromPromise(async ( { input: { context, event, }, }, ): Promise<PublishItemData[]> => {
//   console.log('getSeeds', context,)
//
//   const { publishAsNewVersion, editedProperties, } = context
//
//   const publishAttempt = await getPublishAttempt(context,)
//
//   const modelInstance = await getModelInstance(publishAttempt,)
//
//   if ( !modelInstance ) {
//     throw new Error('No model instance',)
//   }
//
//   if ( modelInstance.activeVersion && modelInstance.activeVersion.uid ) {
//     throw new Error('Version already published',)
//   }
//
//   if ( !publishAsNewVersion && (!editedProperties || editedProperties.size === 0) ) {
//     throw new Error('No edited properties',)
//   }
//
//   if ( context.publishAsNewVersion ) {
//     // TODO: Handle this situation
//   }
//
//   return await getSeedsToCreate(modelInstance,)
// },)
