import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles.css'
import './seedInit'
import { queryClient } from '../src/browser/helpers'
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

dotenv.config()

localStorage.debug = 'app:internal:actors:*'

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
