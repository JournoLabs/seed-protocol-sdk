import { useCreateItem, useItems } from '../src/browser/react'
import { ModelClassType } from '../src/types/model'
import { useEffect } from 'react'
import ItemView from './Item'

type ItemListProps = {
  ModelClass: ModelClassType
}

const ItemList = ({ ModelClass }: ItemListProps) => {
  const { items, deleteItem, isDeletingItem, refresh } = useItems(ModelClass)
  const { createItem, isCreatingItem, newItem } = useCreateItem(ModelClass)

  useEffect(() => {
    if (newItem) {
      console.log('[ItemList] newItem', newItem)
    }
  }, [newItem])

  const handleCreateItem = () => {
    // If we're creating a new item from scratch, it requires both a Seed
    // and an initial Version.
    createItem({})
  }

  return (
    <>
      <div className={'max-w-2xl relative my-8'}>
        <div className={'grid grid-cols-3'}>
          <span>Number of items:</span>
          <span>{items ? items.length : 0}</span>
          <div>
            <button
              className={
                'border border-gray-600 text-gray-600 rounded p-1 tx-sm w-36'
              }
              onClick={handleCreateItem}
            >
              {isCreatingItem
                ? 'Creating...'
                : `Create ${ModelClass.originalConstructor.name}`}
            </button>
          </div>
        </div>
      </div>
      <div className={'flex flex-col max-w-4xl overflow-hidden'}>
        {items && items.length > 0 && (
          <ul>
            {items.map((item, index) => (
              <ItemView
                key={item.seedLocalId}
                itemLocalId={item.seedLocalId}
                modelName={ModelClass.originalConstructor.name}
                deleteItem={deleteItem}
                isDeletingItem={isDeletingItem}
                refresh={refresh}
              />
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

export default ItemList
