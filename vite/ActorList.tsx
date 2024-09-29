import { useEffect, useState } from 'react'
import { eventEmitter } from '../src/eventBus'
import ActorItem from './ActorItem'
import { ActorRef } from 'xstate'
import { findIndex, orderBy } from 'lodash'
import { produce } from 'immer'

const ActorList = () => {
  const [actors, setActors] = useState<ActorRef<any, any>[]>([])

  const actorsMap = new Map<string, ActorRef<any, any>>()

  useEffect(() => {
    const globalServiceListener = (event) => {
      if (
        event.actorRef &&
        event.actorRef.logic &&
        event.actorRef.logic.config
      ) {
        const config = event.actorRef.logic.config
        if (!config.id) {
          return
        }
        let uniqueKey = config.id
        if (config.id.includes('@seedSdk/')) {
          uniqueKey = config.id.match(/^.*@seedSdk\/(\w+)[\.\w]*/)[1]
        }
        if (event.actorRef.getSnapshot()) {
          const context = event.actorRef.getSnapshot().context
          if (context && context.dbName) {
            uniqueKey = context.dbName
          }
          if (context && context.modelNamePlural) {
            uniqueKey = context.modelNamePlural
          }
        }
        event.actorRef.uniqueKey = uniqueKey
        actorsMap.set(uniqueKey, event.actorRef)
        let actorsArray = Array.from(actorsMap.values())
        actorsArray = orderBy(actorsArray, (a) => a.logic.config.id, ['asc'])

        const postActorIndex = findIndex(
          actorsArray,
          (a) => a.uniqueKey === 'posts',
        )

        setActors(
          produce(actors, (draft) => {
            return actorsArray
          }),
        )
      }
    }

    eventEmitter.addListener('inspect.globalService', globalServiceListener)

    return () => {
      eventEmitter.removeListener(
        'inspect.globalService',
        globalServiceListener,
      )
    }
  }, [])

  return (
    <>
      <div className={'flex flex-row items-center mt-8 mb-5'}>
        <h2 className={'mb-0'}>Services</h2>
        <span
          className={'bg-gray-100 text-gray-700 font-mono p-1 ml-5 rounded'}
        >
          {actors.length}
        </span>
      </div>
      <div
        key={actors.length}
        className={'p-5 mb-8 grid grid-cols-4 w-full gap-4'}
      >
        {actors &&
          actors.length > 0 &&
          actors.map((actor, index) => (
            <ActorItem
              key={`${actor.sessionId}-${index}`}
              actor={actor}
            />
          ))}
      </div>
    </>
  )
}

export default ActorList
