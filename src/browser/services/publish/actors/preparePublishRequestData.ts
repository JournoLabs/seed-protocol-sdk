import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput, PublishMachineContext } from '@/types'
import { Item } from '@/browser/item'
import { models as modelsTable, modelUids } from '@/shared/seedSchema'
import { getAppDb } from '@/browser'
import { eq } from 'drizzle-orm'
import { getModelSchemas } from '@/browser/db/read/getModelSchemas'

export const preparePublishRequestData = fromCallback<
  EventObject,
  FromCallbackInput<PublishMachineContext>
>(({ sendBack, input: { context } }) => {
  const { localId } = context

  const _preparePublishRequestData = async () => {
    const item = await Item.find({ seedLocalId: localId })

    if (!item) {
      return false
    }

    const appDb = getAppDb()

    const modelsRows = await appDb
      .select({
        modelName: modelsTable.name,
        schemaUid: modelUids.uid,
      })
      .from(modelsTable)
      .leftJoin(modelUids, eq(modelUids.modelId, modelsTable.id))
      .where(eq(modelsTable.name, 'Version'))

    if (!modelsRows || modelsRows.length === 0) {
      sendBack({ type: 'preparePublishRequestDataError' })
      return false
    }

    const versionSchemaUid = modelsRows[0].schemaUid

    const editedProperties = await item.getEditedProperties()

    const { modelSchemas, schemaStringToModelRecord } = await getModelSchemas({
      sdkConfigDb: appDb,
    })

    // const dataEncoder = new SchemaEncoder(modelProperty.schemaDefinition,)
    // const encodedData = dataEncoder.encodeData(data,)
    //
    // itemData.listOfAttestations.push({
    //   schema : modelProperty.schemaUid,
    //   data   : [
    //     {
    //       ...defaultAttestationData,
    //       data : encodedData,
    //     },
    //   ],
    // },)

    const publishRequestData = {
      seedIsRevocable: false,
      seedSchemaUid: item.schemaUid,
      seedUid: item.seedUid,
      versionSchemaUid,
      versionUid: item.latestVersionUid,
      listOfAttestations: [],
    }

    sendBack({
      type: 'updateContext',
      ...publishRequestData,
    })

    return true
  }

  _preparePublishRequestData().then((success) => {
    if (success) {
      sendBack({ type: 'preparePublishRequestDataSuccess' })
    }
  })
})
