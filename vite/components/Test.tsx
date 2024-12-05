import { FC, HTMLAttributes } from 'react'
import TestItem from './TestItem'
import { useItems } from '../../src/browser/react/item'

type TestProps = HTMLAttributes<HTMLDivElement> & {}

const Test: FC<TestProps> = () => {
  const { items, isReadingDb, isInitialized } = useItems('Identity', {
    limit: 10,
  })

  return (
    <div className={'mt-12'}>
      <h1>Test</h1>
      <div>
        {isInitialized && !isReadingDb && (!items || items.length === 0) && (
          <p>No items</p>
        )}
        {(!isInitialized || isReadingDb) && (!items || items.length === 0) && (
          <p>Loading...</p>
        )}
        {!isReadingDb &&
          items &&
          items.map((item, index) => (
            <TestItem
              key={item.seedLocalId || item.getService().id || index}
              modelName={'Identity'}
              seedLocalId={item.seedLocalId}
            />
          ))}
      </div>
    </div>
  )
}

export default Test
