import { useImmer } from 'use-immer'
import { Item } from '@/browser/Item'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSelector } from '@xstate/react'
import debug from 'debug'
import { eventEmitter } from '@/eventBus'
import { ItemProperty } from '@/browser/ItemProperty/ItemProperty'
import { useGlobalServiceStatus } from '@/browser/react/services'
import { IItemProperty } from '@/interfaces'

const logger = debug('app:react:property')

type UseItemPropertyProps = {
  propertyName: string
  seedLocalId?: string
  seedUid?: string
}

type UseItemPropertyReturn = {
  property: IItemProperty<any> | undefined
  isInitialized: boolean
  value: any
  status: string
}

type UseItemProperty = (props: UseItemPropertyProps) => UseItemPropertyReturn

export const useItemProperty: UseItemProperty = ({
  propertyName,
  seedLocalId,
  seedUid,
}) => {
  const [property, setProperty] = useState<IItemProperty<any> | undefined>()
  const [isInitialized, setIsInitialized] = useState(false)

  const { internalStatus } = useGlobalServiceStatus()

  const isReadingDb = useRef(false)

  const value = useSelector(property?.getService(), (snapshot) => {
    if (!snapshot || !snapshot.context) {
      return
    }
    return snapshot.context.renderValue || snapshot.context.propertyValue
  })

  const status = useSelector(
    property?.getService(),
    (snapshot) => snapshot?.value as string,
  )

  const readFromDb = useCallback(async () => {
    if (
      internalStatus !== 'ready' ||
      isReadingDb.current ||
      (!seedLocalId && !seedUid)
    ) {
      return
    }
    isReadingDb.current = true
    const foundProperty = await ItemProperty.find({
      propertyName,
      seedLocalId,
      seedUid,
    })
    if (!foundProperty) {
      logger(
        `[useItemPropertyTest] [readFromDb] no property found for Item.${seedLocalId}.${propertyName}`,
      )
      isReadingDb.current = false
      return
    }
    if (foundProperty.status === 'waitingForDb') {
      foundProperty.getService().send({ type: 'waitForDbSuccess' })
    }
    setProperty(foundProperty)
    setIsInitialized(true)
    isReadingDb.current = false
  }, [internalStatus])

  const listenerRef = useRef(readFromDb)

  useEffect(() => {
    listenerRef.current = readFromDb
  }, [readFromDb])

  useEffect(() => {
    if (internalStatus === 'ready') {
      readFromDb()
    }
  }, [internalStatus])

  useEffect(() => {
    eventEmitter.addListener(
      `property.${seedUid || seedLocalId}.${propertyName}.update`,
      () => {
        listenerRef.current()
      },
    )

    return () => {
      eventEmitter.removeListener(
        `property.${seedUid || seedLocalId}.${propertyName}.update`,
      )
    }
  }, [])

  return {
    property,
    isInitialized,
    value,
    status,
  }
}
export const useItemProperties = (item?: Item<any>) => {
  const [propertyObj, setPropertyObj] = useImmer({})
  const [isListening, setIsListening] = useState(false)

  const updatePropertyObj = useCallback(
    (event) => {
      if (!item) {
        console.error('[XXXXXX] [updatePropertyObj] no item when expected')
        return
      }
      const { propertyName, propertyValue } = event
      if (!propertyName) {
        return
      }
      setPropertyObj((draft) => {
        draft[propertyName] = propertyValue
      })
    },
    [item],
  )

  useEffect(() => {
    if (!item) {
      return
    }

    const eventKey = `item.${item.seedLocalId}.property.update`

    eventEmitter.addListener(eventKey, updatePropertyObj)

    return () => {
      eventEmitter.removeListener(eventKey, updatePropertyObj)
    }
  }, [item])

  return {
    properties: propertyObj,
  }
}
