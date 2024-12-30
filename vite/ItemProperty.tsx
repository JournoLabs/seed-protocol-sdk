import { FC, HTMLAttributes, useCallback, useRef, useState } from 'react'
import { CheckIcon, ClipboardIcon } from '@heroicons/react/24/outline'
import { dayjs } from '../src/shared/helpers'
import ImageUpload from './components/Image/ImageUpload'
import { useItemProperty } from '../src/browser'
import { Link, useParams } from 'react-router-dom'
import SelectOneToMany from './components/SelectOneToMany'
import { Input } from './components/Input'

const readOnlyProperties = [
  'seedLocalId',
  'seedUid',
  'createdAt',
  'attestationCreatedAt',
]

type ItemPropertyViewProps = HTMLAttributes<HTMLLIElement> & {
  propertyName: string
  seedLocalId?: string
  seedUid?: string
}

const ItemPropertyView: FC<ItemPropertyViewProps> = ({
  propertyName,
  seedLocalId,
  seedUid,
  className,
}) => {
  const { modelName } = useParams()

  const { property: itemProperty, status } = useItemProperty({
    propertyName,
    seedLocalId,
    seedUid,
  })

  const [valueCopied, setValueCopied] = useState(false)

  const isEditable = useRef(false)

  if (!readOnlyProperties.includes(propertyName)) {
    isEditable.current = true
  }

  const handleSave = useCallback(
    (value) => {
      if (!itemProperty) {
        return
      }
      itemProperty.value = value
    },
    [itemProperty],
  )

  const getValueDisplay = useCallback(
    (valueFromRender: any) => {
      if (
        !valueFromRender &&
        itemProperty &&
        itemProperty.propertyDef &&
        itemProperty.propertyDef.ref === 'Image'
      ) {
        return <ImageUpload itemProperty={itemProperty} />
      }

      if (
        itemProperty &&
        itemProperty.propertyDef &&
        itemProperty.propertyDef.dataType === 'List'
      ) {
        return <SelectOneToMany />
      }

      const valueType = typeof valueFromRender
      if (
        itemProperty &&
        valueType === 'string' &&
        valueFromRender.startsWith('blob:')
      ) {
        return (
          <div className={'flex flex-col'}>
            <img
              className={'mb-5'}
              src={valueFromRender}
              alt={''}
              style={{ width: '400px' }}
            />
            <ImageUpload itemProperty={itemProperty} />
          </div>
        )
      }
      if (valueType === 'string' && valueFromRender.length > 0) {
        if (propertyName === 'seedLocalId' && valueFromRender.length === 10) {
          return (
            <Link
              to={`/${modelName}/${valueFromRender}`}
              className={'text-blue-500 hover:underline'}
            >
              {valueFromRender}
            </Link>
          )
        }
        if (
          propertyName === 'storageTransactionId' &&
          valueFromRender.length === 43
        ) {
          return (
            <a
              className={'text-blue-500 hover:underline'}
              href={'https://viewblock.io/arweave/tx/' + valueFromRender}
              target={'_blank'}
            >
              {valueFromRender}
            </a>
          )
        }
        if (valueFromRender.length === 66 && valueFromRender.startsWith('0x')) {
          return (
            <a
              className={'text-blue-500 hover:underline'}
              href={
                'https://optimism-sepolia.easscan.org/attestation/view/' +
                valueFromRender
              }
              target={'_blank'}
            >
              {valueFromRender}
            </a>
          )
        }
        if (valueFromRender.length > 300) {
          return (
            <span>
              {valueFromRender.slice(0, 300)} <span>...</span>
            </span>
          )
        }
        if (isEditable.current) {
          return (
            <Input
              key={itemProperty?.localId}
              value={valueFromRender}
              onChange={handleSave}
            />
          )
        }
        return <span>{valueFromRender}</span>
      }
      if (valueType === 'number') {
        if (valueFromRender.toString().length === 13) {
          return (
            <span>{dayjs(valueFromRender).format('YYYY-MM-DD HH:mm:ss')}</span>
          )
        }
        return <span>{valueFromRender}</span>
      }
      if (Array.isArray(valueFromRender)) {
        return (
          <ul>
            {valueFromRender.map((v, i) => (
              <li key={i}>{getValueDisplay(v)}</li>
            ))}
          </ul>
        )
      }
      if (valueType === 'object') {
        return <span>{JSON.stringify(valueFromRender)}</span>
      }
      if (
        valueType === 'undefined' ||
        (valueType === 'string' && valueFromRender.length === 0)
      ) {
        if (isEditable.current) {
          return (
            <Input
              key={itemProperty?.localId}
              value={valueFromRender}
              onChange={handleSave}
            />
          )
        }
        return <span className={'text-gray-200'}>undefined</span>
      }
      return <span className={'text-gray-200'}>undefined</span>
    },
    [itemProperty],
  )

  // const handleEditClick = useCallback(
  //   (propertyName: string) => {
  //     console.log(
  //       `[ItemPropertyView] [handleEditClick] ${propertyName}: ${value}`,
  //     )
  //   },
  //   [propertyName, value],
  // )

  const handleCopyToClipboard = async (valueFromRender) => {
    await navigator.clipboard.writeText(valueFromRender)
    setValueCopied(true)
    setTimeout(() => {
      setValueCopied(false)
    }, 5000)
  }

  return (
    <li className={`item-property group ${className}`}>
      <div className={'w-96'}>
        <span className={'font-bold text-lg'}>{propertyName}</span>
      </div>
      <div
        className={'col-span-2 font-mono relative flex flex-row items-center'}
      >
        {!!itemProperty && (
          <>
            <button
              className={
                'absolute left-0 hidden group-hover:block my-auto h-4 w-4 -ml-8'
              }
              onClick={() => handleCopyToClipboard(itemProperty.value)}
            >
              {valueCopied && <CheckIcon className={'text-green-600'} />}
              {!valueCopied && (
                <ClipboardIcon
                  className={'text-gray-400 hover:text-blue-500'}
                />
              )}
            </button>
            <div
              className={`overflow-hidden w-4/5 h-full ${typeof itemProperty.value === 'undefined' ? 'text-gray-200' : ''}`}
            >
              {!status && <span className={'text-gray-300'}>Loading ...</span>}
              {!!status && status !== 'idle' && (
                <span className={'text-gray-300'}>
                  {typeof status === 'object' ? Object.keys(status)[0] : status}
                </span>
              )}
              {getValueDisplay(itemProperty.value)}
            </div>
            {/*<button*/}
            {/*  className={'absolute right-0 hidden mr-8 group-hover:block h-5 w-5'}*/}
            {/*  onClick={() => handleEditClick(propertyName)}*/}
            {/*>*/}
            {/*  <PencilIcon className={'text-gray-300 hover:text-blue-500'} />*/}
            {/*</button>*/}
          </>
        )}
      </div>
    </li>
  )
}

export default ItemPropertyView
