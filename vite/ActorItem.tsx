import { ActorRef } from 'xstate'
import { useCallback, useEffect, useState } from 'react'

type ActorItemProps = {
  actor: ActorRef<any, any>
}

type ActorItemType = (props: ActorItemProps) => JSX.Element

const finalStrings = ['idle', 'ready', 'done', 'success']

const ActorItem: ActorItemType = ({ actor }) => {
  const [timeElapsed, setTimeElapsed] = useState(0)

  const getName = (innerActor: ActorRef<any, any>) => {
    let name = 'actor'
    if (innerActor && innerActor.uniqueKey) {
      name = innerActor.uniqueKey
    }
    if (
      innerActor &&
      !innerActor.uniqueKey &&
      innerActor.logic &&
      innerActor.logic.config
    ) {
      name = innerActor.logic.config.id
      if (name && name.includes('@seedSdk/')) {
        name = name.replace('@seedSdk/', '')
      }
    }
    return name
  }

  const getValue = (innerActor: ActorRef<any, any>) => {
    let value = 'value'
    if (
      innerActor &&
      innerActor.getSnapshot() &&
      innerActor.getSnapshot().value &&
      typeof innerActor.getSnapshot().value === 'string'
    ) {
      value = innerActor.getSnapshot().value
    }
    return value
  }

  const getPercentComplete = (innerActor: ActorRef<any, any>) => {
    let percentComplete = 0
    if (innerActor.logic.states) {
      const stateNames = Object.keys(innerActor.logic.states)
      const totalStates = stateNames.length
      const value = getValue(innerActor)
      if (finalStrings.includes(value)) {
        return 0
      }
      const stateIndex = stateNames.indexOf(value)
      percentComplete = (stateIndex / totalStates) * 100
    }
    return percentComplete
  }

  const updateTime = useCallback(
    (interval) => {
      const context = actor.getSnapshot().context
      if (context && context.times) {
        console.log('[ActorItem] [useEffect] context.times', context.times)
      }
      const status = actor.getSnapshot().value
      if (
        status === 'done' ||
        status === 'success' ||
        status === 'idle' ||
        status === 'ready'
      ) {
        clearInterval(interval)
        return
      }
      setTimeElapsed((timeElapsed) => timeElapsed + 1)
    },
    [actor],
  )

  const startInterval = useCallback(() => {
    const interval = setInterval(() => {
      updateTime(interval)
    }, 1000)
    return interval
  }, [updateTime, actor])

  useEffect(() => {
    const interval = startInterval()
    return () => clearInterval(interval)
  }, [])

  return (
    <div
      className={'flex flex-col border border-gray-200 rounded p-5 space-y-3'}
    >
      {actor && (
        <>
          <div className={'flex flex-row items-center justify-between'}>
            <span
              className={'font-bold mb-2 font-mono bg-gray-100 rounded p-2'}
            >
              {getName(actor)}
            </span>
            <span className={'text-gray-400 text-xs font-mono'}>
              {timeElapsed}s
            </span>
          </div>
          <div>
            <span className={'text-sm mb-5 text-gray-400'}>
              {getValue(actor)}
            </span>
          </div>
          <div className={'w-full h-3'}>
            {getPercentComplete(actor) > 0 && (
              <div
                className={`border-b border-2 border-sky-500 transition-width duration-300`}
                style={{
                  width: `${getPercentComplete(actor).toString()}%`,
                }}
              />
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default ActorItem
