import { Item, ItemProperty } from '@/browser'
import Transaction from 'arweave/web/lib/transaction'
import { CreateTransactionInterface } from 'arweave/web'
import { getArweave } from '@/browser/helpers/arweave'
import { fs } from '@zenfs/core'
import { getCorrectId } from '@/browser/helpers'
import { getSegmentedItemProperties } from '@/browser/helpers/getSegmentedItemProperties'
import debug from 'debug'

const logger = debug('app:item:getPublishUploads')

export const getContentHash = async (
  base64: string | null | undefined,
  uint: Uint8Array | undefined,
): Promise<string> => {
  let data

  if (base64 && !uint) {
    const encoder = new TextEncoder()
    data = encoder.encode(base64)
  }

  if (uint) {
    data = uint
  }

  // Hash the data with SHA-256
  const hashBuffer = await crypto.subtle.digest('SHA-256', data as Uint8Array)

  // Convert the ArrayBuffer to a hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}
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
export type UploadProperty = {
  itemProperty: ItemProperty<any>
  childProperties: ItemProperty<any>[]
}
type ChildUploadData = {
  propertyName: string
  localStoragePath: string
}
const processUploadProperty = async (
  uploadProperty: UploadProperty,
  uploads: PublishUpload[],
  relatedItemProperty?: ItemProperty<any>,
): Promise<PublishUpload[]> => {
  const itemProperty = uploadProperty.itemProperty

  const childUploads: ChildUploadData[] = []

  for (const childProperty of uploadProperty.childProperties) {
    const filePath = childProperty.localStoragePath

    if (!filePath) {
      throw new Error(
        `No localStoragePath found for ItemProperty ${childProperty.propertyName}`,
      )
    }

    const exists = await fs.promises.exists(filePath)
    if (!exists) {
      throw new Error(`File doesn't exist at ${filePath}`)
    }

    childUploads.push({
      propertyName: childProperty.propertyName,
      localStoragePath: filePath,
    })
  }

  // const filePath = itemProperty.localStoragePath
  //
  // if (!filePath) {
  //   throw new Error(
  //     `No localStoragePath found for ItemProperty ${itemProperty.propertyName}`,
  //   )
  // }
  //
  // const exists = await fs.promises.exists(filePath)
  // if (!exists) {
  //   throw new Error(`File doesn't exist at ${filePath}`)
  //
  //   // const handle = await navigator.storage.getDirectory()
  //   //
  //   // await configureSingle({
  //   //   backend: WebAccess,
  //   //   handle,
  //   // })
  // }
  //
  // const mainFileContents = await fs.promises.readFile(filePath)
  let fileContents
  let transaction: Transaction

  if (!childUploads || childUploads.length === 0) {
    if (relatedItemProperty && relatedItemProperty.localStoragePath) {
      const filePath = relatedItemProperty.localStoragePath

      const exists = await fs.promises.exists(filePath)
      if (!exists) {
        throw new Error(`File doesn't exist at ${filePath}`)

        // const handle = await navigator.storage.getDirectory()
        //
        // await configureSingle({
        //   backend: WebAccess,
        //   handle,
        // })
      }

      fileContents = await fs.promises.readFile(filePath)
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
      const childUploadContents = await fs.promises.readFile(
        childUpload.localStoragePath,
      )
      compositeFileContents += `${separator}${childUpload.propertyName}${separator}${childUploadContents}`
    }

    fileContents = Buffer.from(compositeFileContents)
  }

  if (!fileContents) {
    throw new Error(`No file contents found for ${itemProperty.propertyName}`)
  }

  const uint8Array = new Uint8Array(
    fileContents.buffer,
    fileContents.byteOffset,
    fileContents.byteLength,
  )

  const contentHash = await getContentHash(null, uint8Array)

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
  item: Item<any>,
  uploads: PublishUpload[] = [],
  relatedItemProperty?: ItemProperty<any>,
) => {
  if (item.modelName === 'Post') {
    if (!item.authors) {
      item.authors = [
        'Sr0bIx9Fwj',
        '0xc2879650e9503a303ceb46f966e55baab480b267dc20cede23ef503622eee6d7',
      ]
    }
  }

  const { itemUploadProperties, itemRelationProperties } =
    getSegmentedItemProperties(item)

  for (const uploadProperty of itemUploadProperties) {
    uploads = await processUploadProperty(
      uploadProperty,
      uploads,
      relatedItemProperty,
    )
  }

  for (const relationProperty of itemRelationProperties) {
    const propertyValue = relationProperty.getService().getSnapshot()
      .context.propertyValue

    if (!propertyValue || relationProperty.uid) {
      continue
    }

    const { localId: seedLocalId, uid: seedUid } = getCorrectId(propertyValue)

    const relatedItem = await Item.find({
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
