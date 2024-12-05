import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput } from '@/types/machines'
import {
  ItemPropertyValueType,
  PropertyMachineContext,
  SaveValueToDbEvent,
} from '@/types/property'

export const saveListRelation = fromCallback<
  EventObject,
  FromCallbackInput<PropertyMachineContext, SaveValueToDbEvent>
>(({ sendBack, input: { context, event } }) => {
  const {
    localId,
    propertyName: propertyNameRaw,
    versionLocalId,
    seedUid,
    seedLocalId,
    propertyValue: existingValue,
    propertyRecordSchema,
  } = context

  if (!propertyRecordSchema) {
    throw new Error('Missing propertyRecordSchema')
  }

  let newValue: ItemPropertyValueType

  if (event) {
    newValue = event.newValue
  }

  const _saveListRelation = async (): Promise<boolean> => {
    let refResolvedDisplayValue
    let refSeedType
    let propertyName = propertyNameRaw
    let versionLocalIdToSave = versionLocalId

    const refResolvedValue = newValue

    if (!propertyName.endsWith('Ids')) {
      propertyName = `${propertyName}Ids`
    }

    let newValueType

    if (typeof newValue === 'string') {
      newValue = newValue.split(',')
    }

    if (!Array.isArray(newValue)) {
      sendBack({
        type: 'saveListRelationFailure',
      })
      return false
    }

    // Should have array of ids here

    return true

    // let fileType
    //
    // const dirs = await fs.promises.readdir('/files')
    //
    // for (const dir of dirs) {
    //   const files = await fs.promises.readdir(`/files/${dir}`)
    //   if (newValue && files.includes(newValue as string)) {
    //     fileType = dir
    //     break
    //   }
    // }
    //
    // if (newValue && fileType === 'images') {
    //   const filePath = `/files/images/${newValue}`
    //   refResolvedDisplayValue = await getContentUrlFromPath(filePath)
    //   refSeedType = 'image'
    //   newValue = await createSeed({
    //     type: refSeedType,
    //   })
    //   await createVersion({
    //     seedLocalId,
    //     seedUid,
    //     seedType: refSeedType,
    //   })
    // }
    //
    // await updateItemPropertyValue({
    //   propertyLocalId: localId,
    //   propertyName,
    //   newValue,
    //   seedLocalId,
    //   refSeedType,
    //   refResolvedValue,
    //   refResolvedDisplayValue,
    //   versionLocalId,
    //   modelName: itemModelName,
    //   schemaUid,
    // })
  }

  _saveListRelation().then((success) => {
    if (success) {
      sendBack({ type: 'saveRelationSuccess' })
    }
  })
})
