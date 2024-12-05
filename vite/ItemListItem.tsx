import { TrashIcon } from '@heroicons/react/24/outline'
import { useCallback } from 'react'
import ItemPropertyView from './ItemProperty'
import { useItem } from '../src/browser/react/item'
import { useDeleteItem } from '../src/browser/react/trash'

type ItemViewProps = {
  seedLocalId?: string
  seedUid?: string
  modelName: string
  refresh?: () => void
}

const ItemListItem = ({ seedLocalId, seedUid, modelName }: ItemViewProps) => {
  const { item } = useItem({ modelName, seedLocalId, seedUid })
  const { deleteItem, isDeletingItem } = useDeleteItem()

  const handleDelete = useCallback(async () => {
    if (isDeletingItem) {
      return
    }
    if (!item || !item.seedLocalId) {
      return
    }
    await deleteItem(item)
  }, [item, deleteItem, isDeletingItem])

  if (!item) {
    return <></>
  }

  return (
    <div className={'mb-8 p-5 border border-gray-200 rounded relative'}>
      <div
        className={
          'absolute top-0 right-0 flex flex-row w-full justify-end items-center h-8 mt-3 mr-3'
        }
      >
        <button
          className={'text-gray-700'}
          onClick={handleDelete}
        >
          {isDeletingItem && 'Deleting...'}
          {!isDeletingItem && <TrashIcon className={'text-md h-5'} />}
        </button>
      </div>
      <ul>
        {item &&
          item.properties &&
          Object.entries(item.properties).length > 0 &&
          Object.entries(item.properties).map(
            ([propertyName, property], index: number) => (
              <ItemPropertyView
                key={item.seedLocalId + propertyName + index}
                propertyName={propertyName}
                seedLocalId={item.seedLocalId}
                seedUid={item.seedUid}
                className={`grid grid-cols-3 mb-2 py-3 pl-2 group ${index % 2 !== 0 ? 'bg-gray-100' : ''}`}
              />
            ),
          )}
        {item &&
          item.properties &&
          Object.entries(item.properties).length > 0 &&
          !Object.keys(item.properties).includes('createdAt') && (
            <ItemPropertyView
              propertyName={'createdAt'}
              seedLocalId={item.seedLocalId}
              seedUid={item.seedUid}
              className={`grid grid-cols-3 mb-2 py-3 pl-2 group ${Object.entries(item?.properties).length % 2 !== 0 ? 'bg-gray-100' : ''}`}
            />
          )}
      </ul>

      {/*{item &&*/}
      {/*  item.properties &&*/}
      {/*  propertiesFromSchema.length > 0 &&*/}
      {/*  propertiesFromSchema.map(([propertyName, value], index: number) => (*/}
      {/*    <ItemPropertyView*/}
      {/*      key={item.seedLocalId + propertyName + index}*/}
      {/*      propertyName={propertyName}*/}
      {/*      seedLocalId={item.seedLocalId}*/}
      {/*      className={`grid grid-cols-3 mb-2 py-3 pl-2 group ${index % 2 !== 0 ? 'bg-gray-100' : ''}`}*/}
      {/*    />*/}
      {/*  ))}*/}
    </div>
  )
}

export default ItemListItem
