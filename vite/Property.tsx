import { useProperty } from '../src/browser'

type PropertyViewProps = {
  propertyLocalId: string
  modelName: string
}

const PropertyView = ({ propertyLocalId, modelName }: PropertyViewProps) => {
  const { property } = useProperty(modelName, propertyLocalId)

  // console.log('[PropertyView] property', property)

  return (
    <div className={'mb-8 p-5 border border-gray-200 rounded'}>
      <ul>
        {property &&
          Object.entries(property).map(([key, value], index) => (
            <li
              key={key}
              className={`grid grid-cols-3 mb-2 py-3 pl-2 ${index % 2 !== 0 ? 'bg-gray-100' : ''}`}
            >
              <div>
                <span className={'font-bold text-lg'}>{key}</span>
              </div>
              <div className={'col-span-2 font-mono'}>
                {typeof value === 'string' && value.startsWith('blob:') && (
                  <img
                    src={value}
                    alt={property.title}
                    style={{ width: '400px' }}
                  />
                )}
                {typeof value === 'string' && !value.startsWith('blob:') && (
                  <span>{value}</span>
                )}
                {typeof value === 'object' && (
                  <span>{JSON.stringify(value)}</span>
                )}
              </div>
            </li>
          ))}
        {/*{property && (*/}
        {/*  <>*/}
        {/*    <li>property.localId: {property.localId}</li>*/}
        {/*    <li>property.schemaUid: {property.schemaUid}</li>*/}
        {/*    <li>property.versionUid: {property.versionUid}</li>*/}
        {/*    <li>property.title: {property.title}</li>*/}
        {/*    <li>property.summary: {property.summary}</li>*/}
        {/*    <li>property.featureImage: {property.featureImage}</li>*/}
        {/*    {property.featureImage && property.featureImage.startsWith('blob:') && (*/}
        {/*      <li>*/}
        {/*        <img*/}
        {/*          src={property.featureImage}*/}
        {/*          alt={property.title}*/}
        {/*          style={{ width: '400px' }}*/}
        {/*        />*/}
        {/*      </li>*/}
        {/*    )}*/}
        {/*  </>*/}
        {/*)}*/}
      </ul>
    </div>
  )
}

export default PropertyView
