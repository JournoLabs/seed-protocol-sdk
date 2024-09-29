import { useEffect } from 'react'
import Events from './Events'
import ActorList from './ActorList'
import ModelsDisplay from './ModelsDisplay'

const DevApp = () => {
  useEffect(() => {
    console.log('DevApp mounted')

    const _init = async (): Promise<void> => {}

    _init()

    return () => {
      console.log('DevApp unmounted')
    }
  }, [])

  return (
    <main>
      <h1>Seed Protocol SDK</h1>
      <p>
        Seed Protocol SDK is a TypeScript library for building Seed Protocol
        applications.
      </p>
      <p>
        It is a collection of tools and utilities that make it easy to build
        Seed Protocol applications.
      </p>
      <Events />
      <ActorList />
      <h2>Models</h2>
      <ModelsDisplay />
    </main>
  )
}

export default DevApp
