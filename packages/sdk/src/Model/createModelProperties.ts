import type { ActorRefFrom } from 'xstate'
import type { modelMachine } from './service/modelMachine'
import { BaseDb } from '@/db/Db/BaseDb'
import { properties as propertiesTable } from '@/seedSchema/ModelSchema'
import { isActorStopped } from '@/helpers/entity/entityCommon'
import debug from 'debug'

const logger = debug('seedSdk:model:createModelProperties')

/**
 * Creates and caches the ModelProperty instances for the properties passed to Model.create, from
 * the rows the model's write stored. Stops early when the model is stopped (unloaded, or evicted
 * with its schema): a stopped model's properties would be cached for a model that's gone.
 */
export async function createModelProperties(
  service: ActorRefFrom<typeof modelMachine>,
  propertyDefinitions: { [name: string]: any },
): Promise<void> {
  const stopped = () => isActorStopped(service)
  const { id, _dbId, modelName, schemaName } = service.getSnapshot().context
  if (!id || !_dbId || !modelName) {
    throw new Error(
      'Model ID, file ID, and name are required to create properties',
    )
  }

  logger(
    `Creating ${Object.keys(propertyDefinitions).length} properties for model "${modelName}" (id: ${_dbId})`,
  )

  const { ModelProperty } = await import('../ModelProperty/ModelProperty')
  const { and, eq } = await import('drizzle-orm')
  const db = BaseDb.getAppDb()

  for (const [propName, propData] of Object.entries(propertyDefinitions)) {
    // The model's own write (writeModelToDb) normally stored this property already, under
    // propData.id or an id it generated. Reuse that row so the instance gets the same id
    // and doesn't write the property a second time.
    const propertyRecord = db
      ? (
          await db
            .select()
            .from(propertiesTable)
            .where(
              propData.id
                ? eq(propertiesTable.schemaFileId, propData.id)
                : and(
                    eq(propertiesTable.modelId, _dbId),
                    eq(propertiesTable.name, propName),
                  ),
            )
            .limit(1)
        )[0]
      : undefined

    // Otherwise use provided ID or generate a random one
    // IDs should be generated in the import process before creating properties
    const { generateId } = await import('../helpers/generateId')
    const propertyFileId =
      propData.id || propertyRecord?.schemaFileId || generateId()

    logger(`Creating property "${propName}" with fileId "${propertyFileId}"`)

    // Query database to get refModelId if the property has ref/refModelName
    // The property should already be in DB from addModelsToDb
    let refModelId: number | undefined = propData.refModelId
    if (!refModelId && (propData.ref || propData.refModelName) && db) {
      try {
        const refModelName = propData.refModelName || propData.ref
        // First try to get refModelId from the property record in the database
        if (propertyRecord?.refModelId) {
          refModelId = propertyRecord.refModelId
          logger(
            `Found refModelId ${refModelId} from database for property "${propName}"`,
          )
        } else if (refModelName) {
          // Fallback: resolve the ref by name within this model's schema
          const { resolveModelRecord } =
            await import('../db/read/resolveModelRecord')
          const refModelRecord = await resolveModelRecord(
            refModelName,
            { schemaName },
            db,
          )

          if (refModelRecord?.id) {
            refModelId = refModelRecord.id
            logger(
              `Resolved refModelId ${refModelId} from model name "${refModelName}" for property "${propName}"`,
            )
          }
        }
      } catch (error) {
        logger(`Error fetching refModelId for property "${propName}":`, error)
        // Continue without refModelId - it will be resolved later in _initializeOriginalValues
      }
    }

    if (stopped()) {
      logger(
        `Model "${modelName}" was stopped while creating its properties; not creating the rest`,
      )
      return
    }

    // Create ModelProperty instance
    // This will load from DB if it exists, or create new instance
    // The property should already be in DB from writeModelToDb
    // Note: propertyFileId is the schemaFileId (string), not the database ID (number)
    // We pass it as _propertyFileId so getById() can find the instance
    const property = await ModelProperty.create(
      {
        name: propName,
        modelName,
        modelId: _dbId,
        dataType: propData.dataType,
        ref: propData.ref,
        refModelName: propData.refModelName,
        refModelId,
        refValueType: propData.refValueType,
        // Definitions built from DB rows may lack storage settings; the row has them.
        storageType:
          propData.storageType ?? propertyRecord?.storageType ?? undefined,
        localStorageDir:
          propData.localStorageDir ??
          propertyRecord?.localStorageDir ??
          undefined,
        filenameSuffix:
          propData.filenameSuffix ??
          propertyRecord?.filenameSuffix ??
          undefined,
        required: propData.required,
        // Rules defined in code; ModelProperty.create stores them in the row's definition.
        validation: propData.validation,
        htmlEmbeddedDataUriPolicy: propData.htmlEmbeddedDataUriPolicy,
        _propertyFileId: propertyFileId, // Store schemaFileId for getById() lookups
        _dbId:
          propertyRecord?.schemaFileId === propertyFileId
            ? propertyRecord.id
            : undefined, // Already persisted: skip the write
      } as any,
      { schemaName },
    ) // Use 'as any' because _propertyFileId is not in TProperty type
    // The model keeps its properties; an app's unload of the same instance doesn't stop them.
    ModelProperty.adoptForModel(property)
  }

  logger(`Created all properties for model "${modelName}"`)
}
