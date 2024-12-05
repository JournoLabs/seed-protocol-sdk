import { FC, HTMLAttributes } from 'react'

import { useItemProperty } from '../../src/browser/react/property'

type TestPropertyProps = HTMLAttributes<HTMLDivElement> & {
  propertyName: string
  seedLocalId: string
}

const TestProperty: FC<TestPropertyProps> = ({ seedLocalId, propertyName }) => {
  const { property, isInitialized, isReadingFromDb, value, status } =
    useItemProperty({ propertyName, seedLocalId })

  return (
    <>
      {status && (
        <div className={'border border-gray-200 p-5 rounded mb-5'}>
          <div className={'flex flex-row items-center'}>
            <span>{propertyName} / </span>
            <span> {status || 'undefined'} / </span>
            {isInitialized && !isReadingFromDb && !property && (
              <span>No property</span>
            )}
            {isInitialized && !isReadingFromDb && property && (
              <span>{property.value}</span>
            )}
          </div>
        </div>
      )}
    </>
  )
}

export default TestProperty
