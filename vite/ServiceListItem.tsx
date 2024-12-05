import { ActorRef } from 'xstate'
import { useService } from '../src/browser/react/services'

type ActorItemProps = {
  service: ActorRef<any, any>
}

type ActorItemType = (props: ActorItemProps) => JSX.Element

const ServiceListItem: ActorItemType = ({ service }) => {
  const { name, timeElapsed, value, percentComplete, uniqueKey } =
    useService(service)

  return (
    <div
      className={'flex flex-col border border-gray-200 rounded p-5 space-y-3'}
    >
      {service && (
        <>
          <div className={'flex flex-row items-center justify-between'}>
            <span
              className={'font-bold mb-2 font-mono bg-gray-100 rounded p-2'}
            >
              {name}
            </span>
            <span className={'text-gray-400 text-xs font-mono'}>
              {uniqueKey}
            </span>
            <span className={'text-gray-400 text-xs font-mono'}>
              {timeElapsed}s
            </span>
          </div>
          <div>
            <span className={'text-sm mb-5 text-gray-400'}>{value}</span>
          </div>
          <div className={'w-full h-3'}>
            {percentComplete > 0 && (
              <div
                className={`border-b border-2 border-sky-500 transition-width duration-300`}
                style={{
                  width: `${percentComplete.toString()}%`,
                }}
              />
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default ServiceListItem
