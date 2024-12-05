// import Test from './components/Test'
import Events from './Events'
import ServiceList from './ServiceList'
import { Outlet } from 'react-router-dom'

const DevApp = () => {
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
      {/*<Test />*/}
      <Events />
      <ServiceList />
      <Outlet />
    </main>
  )
}

export default DevApp
