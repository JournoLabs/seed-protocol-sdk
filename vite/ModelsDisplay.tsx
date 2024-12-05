import { models } from '../__tests__/__mocks__/project/schema'
import ItemList from './ItemList'
import { Tab, TabGroup, TabList, TabPanel, TabPanels } from '@headlessui/react'
import { Fragment, memo, useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'

const modelNames = Object.keys(models)

const TabContent = memo(({ modelName }: { modelName: string }) => {
  return <ItemList modelName={modelName} />
})

const ModelsDisplay = () => {
  const { modelName, seedId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()

  // Initialize the active index based on the URL parameter or default to the first tab
  const initialIndex = modelName ? modelNames.indexOf(modelName) : 0
  const [selectedIndex, setSelectedIndex] = useState(
    initialIndex !== -1 ? initialIndex : 0,
  )

  // Update the tab when the URL parameter changes
  useEffect(() => {
    if (modelName && modelNames.includes(modelName)) {
      setSelectedIndex(modelNames.indexOf(modelName))
    }
  }, [modelName])

  // Update the URL when the tab changes
  useEffect(() => {
    const currentTab = modelNames[selectedIndex]
    if (!seedId && location.pathname !== `/${currentTab}`) {
      navigate(`/${currentTab}`, { preventScrollReset: true })
    }
  }, [selectedIndex, navigate, location])

  return (
    <TabGroup
      as={'div'}
      className={'w-full mt-8'}
      selectedIndex={selectedIndex}
      onChange={setSelectedIndex}
    >
      <h2>Models</h2>
      <TabList
        as={'div'}
        className={'flex flex-row items-center gap-x-4 mb-5 mt-5'}
      >
        {Object.entries(models).map(([modelName]) => {
          return (
            <Tab
              key={`${modelName}Tab`}
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
        {Object.entries(models).map(([modelName]) => {
          return (
            <TabPanel
              key={`${modelName}TabPanel`}
              className={'pt-6'}
            >
              <TabContent modelName={modelName} />
            </TabPanel>
          )
        })}
      </TabPanels>
    </TabGroup>
  )
}

export default ModelsDisplay
