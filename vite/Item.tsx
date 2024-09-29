import { useItem } from '../src/browser/react'
import { TrashIcon } from '@heroicons/react/24/outline'
import { useCallback, useState } from 'react'
import { Item } from '../src/browser'
import { dayjs } from '../src/shared/helpers'

type ItemViewProps = {
  itemLocalId: string
  modelName: string
  deleteItem: (item: Item<any>) => Promise<void>
  refresh: () => void
  isDeletingItem?: boolean
}

const ItemView = ({
  itemLocalId,
  modelName,
  deleteItem,
  refresh,
}: ItemViewProps) => {
  const [isDeleting, setIsDeleting] = useState(false)

  const { item } = useItem(modelName, itemLocalId)

  const handleDelete = useCallback(async () => {
    if (isDeleting) {
      return
    }
    setIsDeleting(true)
    if (!item || !item.seedLocalId) {
      return
    }
    await deleteItem(item)
    setIsDeleting(false)
  }, [item, deleteItem, isDeleting])

  const getValueDisplay = (value: any) => {
    const valueType = typeof value
    if (itemLocalId === '2f203keQR8') {
      console.log('[ItemView] getValueDisplay', { value, valueType })
    }
    if (valueType === 'string' && value.startsWith('blob:')) {
      return (
        <img
          src={value}
          alt={item?.title || ''}
          style={{ width: '400px' }}
        />
      )
    }
    if (valueType === 'string') {
      return <span>{value}</span>
    }
    if (valueType === 'number') {
      if (value.toString().length === 13) {
        return <span>{dayjs(value).format('YYYY-MM-DD HH:mm:ss')}</span>
      }
      return <span>{value}</span>
    }
    if (valueType === 'object') {
      return <span>{JSON.stringify(value)}</span>
    }
    if (valueType === 'undefined') {
      return <span className={'text-gray-200'}>undefined</span>
    }
    return <span className={'text-gray-200'}>undefined</span>
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
          {isDeleting && 'Deleting...'}
          {!isDeleting && <TrashIcon className={'text-md h-5'} />}
        </button>
      </div>
      <ul>
        {item &&
          item.properties &&
          Object.entries(item.properties).map(
            ([propertyName, property], index) => (
              <li
                key={item.seedLocalId + propertyName}
                className={`grid grid-cols-3 mb-2 py-3 pl-2 ${index % 2 !== 0 ? 'bg-gray-100' : ''}`}
              >
                <div>
                  <span className={'font-bold text-lg'}>{propertyName}</span>
                </div>
                <div
                  className={
                    'col-span-2 font-mono flex flex-row items-center overflow-hidden'
                  }
                >
                  {getValueDisplay(property.value)}
                </div>
              </li>
            ),
          )}
      </ul>
    </div>
  )
}

export default ItemView
