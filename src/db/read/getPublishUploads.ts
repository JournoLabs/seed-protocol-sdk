import Transaction from 'arweave'
import { CreateTransactionInterface } from 'arweave/web'
import { getArweave } from '@/helpers/ArweaveClient'
import { BaseFileManager, getCorrectId } from '@/helpers'
import { getSegmentedItemProperties } from '@/helpers/getSegmentedItemProperties'
import debug from 'debug'
import { IItem, IItemProperty } from '@/interfaces'
import { getContentHash } from '@/helpers'
import { BaseItem } from '@/Item/BaseItem'
const logger = debug('seedSdk:item:getPublishUploads')


export const prepareArweaveTransaction = async (
  data: string | Uint8Array,
  contentHash: string | undefined,
): Promise<Transaction> => {
  const transactionData: Partial<CreateTransactionInterface> = {
    data,
    tags: [],
  }

  const tx = await getArweave()!.createTransaction(transactionData)

  if (contentHash) {
    logger('contentHash', contentHash)
    logger('adding content hash tag to tx.id:', tx.id)
    tx.addTag('Content-SHA-256', contentHash)
  }

  return tx
}


const getImageUploads = async (itemImageProperties: IItemProperty<any>[]) => {
  const uploads: PublishUpload[] = []

  for (const itemImageProperty of itemImageProperties) {

    const filePath = `/files/images/${itemImageProperty.refResolvedValue}`

    if (!filePath) {
      continue
    }

    const exists = await BaseFileManager.pathExists(filePath)
    if (!exists) {
      continue
    }

    const fileContents = await BaseFileManager.readFileAsString(filePath)

    const contentHash = await getContentHash(fileContents)

    const transaction = await prepareArweaveTransaction(fileContents, contentHash)

    uploads.push({
      itemPropertyName: itemImageProperty.propertyName,
      itemPropertyLocalId: itemImageProperty.localId,
      seedLocalId: itemImageProperty.seedLocalId!,
      versionLocalId: itemImageProperty.versionLocalId!,
      transactionToSign: transaction,
    })
  }

  return uploads
}


export type UploadProperty = {
  itemProperty: IItemProperty<any>
  childProperties: IItemProperty<any>[]
}
type ChildUploadData = {
  propertyName: string
  localStoragePath: string
}
const processUploadProperty = async (
  uploadProperty: UploadProperty,
  uploads: PublishUpload[],
  relatedItemProperty?: IItemProperty<any>,
): Promise<PublishUpload[]> => {
  const itemProperty = uploadProperty.itemProperty

  const childUploads: ChildUploadData[] = []

  for (const childProperty of uploadProperty.childProperties) {
    const filePath = childProperty.localStoragePath

    if (!filePath || filePath.endsWith('undefined')) {
      continue
    }

    const exists = await BaseFileManager.pathExists(filePath)
    if (!exists) {
      continue
    }

    childUploads.push({
      propertyName: childProperty.propertyName,
      localStoragePath: filePath,
    })
  }

  let fileContents
  let transaction: Transaction

  if (!childUploads || childUploads.length === 0) {
    if (relatedItemProperty && relatedItemProperty.localStoragePath) {
      const filePath = relatedItemProperty.localStoragePath

      if (!filePath || filePath.endsWith('undefined')) {
        return uploads
      }

      const exists = await BaseFileManager.pathExists(filePath)
      if (!exists) {
        return uploads

      }

      try {
        fileContents = await BaseFileManager.readFileAsString(filePath)
      } catch (e) {
        const fs = await BaseFileManager.getFs()
        fileContents = fs.readFileSync(filePath)
      }
    }
    if (!fileContents) {
      return uploads
    }
  }

  if (childUploads.length > 0) {
    const separator = '===FILE_SEPARATOR==='
    // let compositeFileContents = `${itemProperty.propertyName}${separator}${mainFileContents}`
    let compositeFileContents = ''

    for (const childUpload of childUploads) {
      let childUploadContents

      const fs = await BaseFileManager.getFs()

      try {
        childUploadContents = await fs.promises.readFile(
          childUpload.localStoragePath,
        )
      } catch (e) {
        childUploadContents = fs.readFileSync(childUpload.localStoragePath)
      }

      compositeFileContents += `${separator}${childUpload.propertyName}${separator}${childUploadContents}`
    }

    if (typeof document !== 'undefined') {
      fileContents = new TextEncoder().encode(compositeFileContents)
    } else {
      fileContents = Buffer.from(compositeFileContents)
    }
  }

  if (!fileContents) {
    throw new Error(`No file contents found for ${itemProperty.propertyName}`)
  }

  const uint8Array = new Uint8Array(
    fileContents.buffer,
    fileContents.byteOffset,
    fileContents.byteLength,
  )

  const contentHash = await getContentHash(uint8Array)

  transaction = await prepareArweaveTransaction(fileContents, contentHash)

  let itemPropertyLocalId = relatedItemProperty
    ? relatedItemProperty.localId
    : itemProperty.localId
  let itemPropertyName = relatedItemProperty
    ? relatedItemProperty.propertyName
    : itemProperty.propertyName

  uploads.push({
    itemPropertyName,
    itemPropertyLocalId,
    seedLocalId: itemProperty.seedLocalId!,
    versionLocalId: itemProperty.versionLocalId!,
    transactionToSign: transaction,
  })

  return uploads
}


export type PublishUpload = {
  itemPropertyName: string
  itemPropertyLocalId: string
  seedLocalId: string
  versionLocalId: string
  transactionToSign: Transaction
}
export const getPublishUploads = async (
  item: IItem<any>,
  uploads: PublishUpload[] = [],
  relatedItemProperty?: IItemProperty<any>,
) => {
  // if (item.modelName === 'Post') {
  //   if (!item.authors) {
  //     item.authors = [
  //       'Sr0bIx9Fwj',
  //       '0xc2879650e9503a303ceb46f966e55baab480b267dc20cede23ef503622eee6d7',
  //     ]
  //   }
  // }

  const { itemUploadProperties, itemRelationProperties, itemImageProperties } =
    getSegmentedItemProperties(item)

  for (const uploadProperty of itemUploadProperties) {
    uploads = await processUploadProperty(
      uploadProperty,
      uploads,
      relatedItemProperty,
    )
  }

  const imageUploads = await getImageUploads(itemImageProperties)
  uploads.push(...imageUploads)

  for (const relationProperty of itemRelationProperties) {
    const propertyValue = relationProperty.getService().getSnapshot()
      .context.propertyValue

    if (!propertyValue || relationProperty.uid) {
      continue
    }

    const { localId: seedLocalId, uid: seedUid } = getCorrectId(propertyValue)

    const relatedItem = await BaseItem.find({
      seedLocalId,
      seedUid,
    })

    if (!relatedItem) {
      throw new Error(
        `No relatedItem found for ${relationProperty.propertyName}`,
      )
    }

    uploads = await getPublishUploads(relatedItem, uploads, relationProperty)
  }

  return uploads
}
