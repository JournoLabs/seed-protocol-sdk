import React from 'react'
import ReactDOM from 'react-dom/client'
import '../src/browser/helpers/EasClient'
import '../src/browser/helpers/FileManager'
import '../src/browser/helpers/ArweaveClientWeb'
import '../src/browser/db/Db'
import './styles.css'
import './seedInit'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { QueryClientProvider } from '@tanstack/react-query'
import App from './DevApp'
import dotenv from 'dotenv'
import {
  createBrowserRouter,
  createRoutesFromElements,
  Navigate,
  Route,
  RouterProvider,
} from 'react-router-dom'
import ItemPage from './pages/ItemPage'
import ModelsDisplay from './ModelsDisplay'
import TrashPage from './pages/TrashPage'
import { QueryClient as ReactQueryClient } from '@tanstack/react-query'

dotenv.config()

localStorage.debug = 'app:internal:actors:*'

const queryClient = new ReactQueryClient({
  defaultOptions: {
    queries: {
      networkMode: 'offlineFirst',
      gcTime: 1000 * 60 * 60 * 24, // 24 hours
    },
  },
})


const router = createBrowserRouter(
  createRoutesFromElements(
    <>
      <Route
        path={'trash'}
        element={<TrashPage />}
      />
      <Route
        path='/'
        element={<App />}
      >
        <Route
          index
          element={
            <Navigate
              to='/Post'
              replace
            />
          }
        />
        <Route
          path=':modelName'
          element={<ModelsDisplay />}
        />
      </Route>
      <Route
        path=':modelName/:seedId'
        element={<ItemPage />}
      />
    </>,
  ),
)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  </React.StrictMode>,
)
