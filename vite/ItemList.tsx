import ItemListItem from './ItemListItem'
import { ArrowPathIcon } from '@heroicons/react/24/outline'
import { useCreateItem, useItems } from '../src/browser/react/item'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef } from 'react'

type ItemListProps = {
  modelName: string
}

const ItemList = ({ modelName }: ItemListProps) => {
  const { items } = useItems({ modelName })
  const { createItem, isCreatingItem } = useCreateItem(modelName)

  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: items ? items.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 900,
    enabled: true,
  })

  const handleCreateItem = () => {
    // If we're creating a new item from scratch, it requires both a Seed
    // and an initial Version.
    const _create = async (): Promise<void> => {
      const newItem = await createItem({ modelName })
    }

    _create()
  }

  const virtualListItems = virtualizer.getVirtualItems()

  return (
    <>
      <div className={'max-w-2xl relative my-8'}>
        <div className={'grid grid-cols-3'}>
          <div>
            <span>Number of items:</span>
          </div>
          <div className={'flex flex-row items-center'}>
            <span>{items ? items.length : 0}</span>
            <button
              className={' text-gray-500 rounded p-1 tx-sm ml-5'}
              // onClick={refresh}
            >
              <ArrowPathIcon className={'h-5 w-5 text-gray-600'} />
            </button>
          </div>
          <div>
            <button
              className={
                'border border-gray-600 text-gray-600 rounded p-1 tx-sm w-36'
              }
              onClick={handleCreateItem}
            >
              {isCreatingItem ? 'Creating...' : `Create ${modelName}`}
            </button>
          </div>
        </div>
      </div>
      <div className={'flex flex-col w-full'}>
        <ul className={'max-w-4xl'}>
          {items &&
            items.length > 0 &&
            items.map((item, index) => (
              <li key={item.seedUid || item.seedLocalId || index}>
                <ItemListItem
                  seedLocalId={item.seedLocalId}
                  seedUid={item.seedUid}
                  modelName={modelName}
                  // refresh={refresh}
                />
              </li>
            ))}
        </ul>
      </div>
      {/*<div*/}
      {/*  ref={parentRef}*/}
      {/*  className={'flex flex-col w-full overflow-scroll'}*/}
      {/*>*/}
      {/*  <div*/}
      {/*    style={{*/}
      {/*      height: virtualizer.getTotalSize(),*/}
      {/*      width: '100%',*/}
      {/*      position: 'relative',*/}
      {/*    }}*/}
      {/*  >*/}
      {/*    {virtualListItems && virtualListItems.length > 0 && (*/}
      {/*      <ul*/}
      {/*        className={'absolute top-0 left-0 max-w-4xl'}*/}
      {/*        style={{*/}
      {/*          transform: `translateY(${virtualListItems[0].start ?? 0}px)`,*/}
      {/*        }}*/}
      {/*      >*/}
      {/*        {virtualListItems.map((virtualItem, index) => {*/}
      {/*          const item = items[virtualItem.index]*/}
      {/*          return (*/}
      {/*            <li*/}
      {/*              key={virtualItem.key}*/}
      {/*              ref={virtualizer.measureElement}*/}
      {/*              data-index={virtualItem.index}*/}
      {/*            >*/}
      {/*              <ItemListItem*/}
      {/*                seedLocalId={item.seedLocalId}*/}
      {/*                modelName={modelName}*/}
      {/*                deleteItem={deleteItem}*/}
      {/*                isDeletingItem={isDeletingItem}*/}
      {/*                // refresh={refresh}*/}
      {/*              />*/}
      {/*            </li>*/}
      {/*          )*/}
      {/*        })}*/}
      {/*      </ul>*/}
      {/*    )}*/}
      {/*  </div>*/}
      {/*</div>*/}
    </>
  )
}

export default ItemList
