import { FC, HTMLAttributes } from 'react'
import TestProperty from './TestProperty'
import { useItem } from '../../src/browser/react/item'

type TestItemProps = HTMLAttributes<HTMLDivElement> & {
  modelName: string
  seedLocalId: string
}

const TestItem: FC<TestItemProps> = ({ seedLocalId, modelName }) => {
  const { item, context, isInitialized } = useItem({ modelName, seedLocalId })

  return (
    <div>
      {isInitialized && context && item && (
        <div>
          <h2>{item.seedLocalId}</h2>
          <div className={'flex flex-col'}>
            {item.properties &&
              Object.entries(item.properties).map(
                ([propertyName, property]) => (
                  <>
                    {/*<p>*/}
                    {/*  {JSON.stringify(property.getService().getSnapshot().context)}*/}
                    {/*</p>*/}
                    {item.seedLocalId && (
                      <>
                        <TestProperty
                          key={`Item_${item.seedLocalId}_${propertyName}_${property.getService().id}`}
                          propertyName={propertyName}
                          seedLocalId={item.seedLocalId}
                        />
                      </>
                    )}
                  </>
                ),
              )}
          </div>
        </div>
      )}
    </div>
  )
}

export default TestItem
