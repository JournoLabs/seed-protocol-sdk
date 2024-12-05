import ServiceListItem from './ServiceListItem'
import {
  Disclosure,
  DisclosureButton,
  DisclosurePanel,
} from '@headlessui/react'
import { useServices } from '../src/browser/react/services'

const ServiceList = () => {
  const { services, percentComplete } = useServices()

  return (
    <Disclosure>
      <DisclosureButton className={'max-w-lg cursor-pointer flex flex-col'}>
        <div className={'flex flex-row items-center text-left mt-12 mb-5'}>
          <h2 className={'mb-0'}>Services</h2>
          <span
            className={'bg-gray-100 text-gray-700 font-mono p-1 ml-5 rounded'}
          >
            {services.length}
          </span>
        </div>
        <div
          className={
            'relative flex flex-row items-center w-full h-2 bg-gray-100 rounded overflow-hidden'
          }
        >
          <div
            className={`absolute h-2 bg-sky-500 transition-width duration-300`}
            style={{
              width: `${percentComplete}%`,
            }}
          />
        </div>
      </DisclosureButton>
      <DisclosurePanel>
        <div
          key={services.length}
          className={'p-5 mb-8 grid grid-cols-4 w-full gap-4'}
        >
          {services &&
            services.length > 0 &&
            services.map((service, index) => (
              <ServiceListItem
                key={`${service.sessionId}-${index}`}
                service={service}
              />
            ))}
        </div>
      </DisclosurePanel>
    </Disclosure>
  )
}

export default ServiceList
