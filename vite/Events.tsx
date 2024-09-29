import { Fragment, useCallback, useEffect, useState } from 'react'
import { eventEmitter } from '../src/eventBus'
import { useImmer } from 'use-immer'

const Events = () => {
  const [eventsCount, setEventsCount] = useState(0)
  const [eventNames, setEventNames] = useState<string[]>([])
  const [eventsCountByName, setEventsCountByName] = useImmer<
    Record<string, number>
  >({})
  const [eventsCountDisplay, setEventsCountDisplay] = useImmer<
    Record<string, number>[]
  >([])

  const updateEventsCount = useCallback(() => {
    setEventsCount((prev) => prev + 1)
  }, [eventsCount])

  const updateEventNames = useCallback(() => {
    setEventNames(eventEmitter.eventNames() as string[])
  }, [eventNames])

  const updateEventsCountByName = useCallback((eventName: string) => {
    setEventsCountByName((draft) => {
      if (!draft[eventName]) {
        draft[eventName] = 1
      }
      if (draft[eventName]) {
        draft[eventName]++
      }
    })
  }, [])

  useEffect(() => {
    const countsArray = Object.entries(eventsCountByName).map(
      ([key, value]) => ({
        key,
        value,
      }),
    )
    countsArray.sort((a, b) => b.value - a.value).slice(0, 10)
    setEventsCountDisplay((draft) => {
      draft.splice(0, draft.length)
      countsArray.forEach((count) => {
        draft.push(count)
      })
    })
  }, [eventsCountByName])

  useEffect(() => {
    const eventsHandler = async (eventName, event) => {
      updateEventsCount()
      updateEventNames()
      updateEventsCountByName(eventName)
    }

    eventEmitter.eventNames().forEach((eventName) => {
      eventEmitter.on(eventName, (event) => {
        eventsHandler(eventName, event)
      })
    })

    return () => {
      eventEmitter.eventNames().forEach((eventName) => {
        eventEmitter.off(eventName, eventsHandler)
      })
    }
  }, [])

  return (
    <>
      <div className={'grid grid-cols-2 mt-12'}>
        <h2>Listeners </h2>
        <div className={'flex flex-row items-center'}>
          <span className={'text-xl'}>{eventNames.length}</span>
        </div>
      </div>
      <div className={'grid grid-cols-2 gap-4 mt-8'}>
        <div className={'font-bold col-span-1'}>
          <span>Event</span>
        </div>
        <div className={'font-bold col-span-1 flex flex-row'}>
          <span>Count</span>
        </div>
        {eventsCountDisplay &&
          eventsCountDisplay.map(({ key, value }) => (
            <Fragment key={key}>
              <div>
                <span className={'font-mono bg-gray-100 rounded p-2 text-sm'}>
                  {key}
                </span>
              </div>
              <div className={'font-mono'}>
                <span>{value}</span>
              </div>
            </Fragment>
          ))}
        <div className={'font-bold col-span-1 flex flex-row mt-5'}>
          <span>Total</span>
        </div>
        <div className={'font-bold col-span-1 flex flex-row mt-5'}>
          <span>{eventsCount}</span>
        </div>
      </div>
    </>
  )
}

export default Events
