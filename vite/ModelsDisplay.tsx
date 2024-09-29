import { models } from '../__tests__/__mocks__/project/schema'
import ItemList from './ItemList'
import { Tab, TabGroup, TabList, TabPanel, TabPanels } from '@headlessui/react'
import { Fragment } from 'react'

const ModelsDisplay = () => {
  return (
    <TabGroup
      as={'div'}
      className={'w-full mt-8'}
    >
      <TabList
        as={'div'}
        className={'flex flex-row items-center gap-x-4 mb-5'}
      >
        {Object.entries(models).map(([modelName]) => {
          return (
            <Tab
              key={modelName}
              as={Fragment}
            >
              {({ hover, selected }) => (
                <button
                  className={`${selected ? 'bg-indigo-100 text-indigo-700' : 'text-gray-500 hover:text-gray-700'} rounded-md px-3 py-2 font-medium`}
                >
                  {modelName}
                </button>
              )}
            </Tab>
          )
        })}
      </TabList>
      <TabPanels>
        {Object.entries(models).map(([modelName, ModelClass]) => {
          return (
            <TabPanel
              key={modelName}
              className={'pt-6'}
            >
              <ItemList ModelClass={ModelClass} />
            </TabPanel>
          )
        })}
      </TabPanels>
    </TabGroup>
  )
}

export default ModelsDisplay
