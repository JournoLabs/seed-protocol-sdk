import { FC } from 'react'
import { Link } from 'react-router-dom'
import { useItems } from '../../src/browser/react/item'

const TrashPage: FC = () => {
  const { items } = useItems({
    modelName: 'Post',
    deleted: true,
  })

  return (
    <div className={'p-12 max-w-4xl'}>
      <Link
        to={`/`}
        className={'text-blue-500 hover:underline'}
      >
        &larr; Back to dashboard
      </Link>
      <h1 className={'text-3xl font-bold my-12 truncate'}>Trash</h1>
      <ul className={'space-y-2 mb-8'}>
        {items &&
          items.map((item, index) => (
            <li
              key={item.seedLocalId || `${item.seedUid}${index}`}
              className={
                'flex flew-row items-center justify-between p-2 border-b border-gray-200'
              }
            >
              <span>{item.seedLocalId || item.seedUid}</span>
            </li>
          ))}
      </ul>
    </div>
  )
}

export default TrashPage
