import { FC, useCallback } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getCorrectId } from '../../src/helpers'
import { useItem, usePublishItem } from '../../src/browser/react/item'
import ItemListItem from '../ItemListItem'
import pluralize from 'pluralize'
import testData from '../../__tests__/__fixtures__/publishPayloadInput.json'

type ItemPageParams = {
  seedId: string
  modelName: string
}

const ItemPage: FC = () => {
  const { seedId, modelName } = useParams() as ItemPageParams

  const { localId, uid } = getCorrectId(seedId as string)

  const { item, itemData } = useItem({
    seedLocalId: localId,
    seedUid: uid,
    modelName,
  })

  const { publishItem, isPublishing } = usePublishItem()

  const handlePublishClick = useCallback(async () => {
    if (item) {
      // const publishUploads = await item.getPublishUploads()
      // // Generate Arweave transactions and pass them into the getPublishPayload function
      // const testTransactions = publishUploads.map((upload, index) => {
      //   return {
      //     txId: `testing${index}`,
      //     itemPropertyLocalId: upload.itemPropertyLocalId,
      //     seedLocalId: upload.seedLocalId,
      //     versionLocalId: upload.versionLocalId,
      //     itemPropertyName: upload.itemPropertyName,
      //   }
      // })
      const payload = await item.getPublishPayload(testData)
      console.log('payload', payload)
    }
    // await publishItem(item)
  }, [item])

  return (
    <div className={'p-12 max-w-4xl'}>
      <Link
        to={`/${modelName}`}
        className={'text-blue-500 hover:underline'}
      >
        &larr; Back to {pluralize(modelName as string)}
      </Link>
      <div className={'flex flex-row items-center justify-between'}>
        <h1 className={'text-3xl font-bold my-12 truncate'}>
          {modelName} {seedId}
        </h1>
        {item && itemData && (
          <button
            className={
              'bg-blue-500 text-white rounded p-2 px-4 hover:bg-blue-600 font-semibold'
            }
            onClick={handlePublishClick}
          >
            {isPublishing ? 'Publishing...' : 'Publish'}
          </button>
        )}
      </div>
      {item && itemData && (
        <ul className={'space-y-2 mb-8'}>
          <li>
            <span className={'font-bold'}>Local ID:</span> {localId}
          </li>
          {item &&
            item.properties &&
            Object.entries(item.properties).map(
              ([propertyName, property], index: number) => (
                <li
                  key={property.localId || `${propertyName}${index}`}
                  className={
                    'flex flew-row items-center justify-between p-2 border-b border-gray-200'
                  }
                >
                  <span>{propertyName}:</span>
                  <span className={'max-w-md truncate overflow-hidden'}>
                    {item[propertyName]}
                  </span>
                </li>
              ),
            )}
        </ul>
      )}
      {(!!localId || !!uid) && !!modelName && (
        <ItemListItem
          seedLocalId={localId}
          seedUid={uid}
          modelName={modelName}
        />
      )}
    </div>
  )
}

export default ItemPage
