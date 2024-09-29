import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles.css' // import './seedInit'
import './seedInit'
import { queryClient } from '../src/browser/helpers'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { QueryClientProvider } from '@tanstack/react-query'
import App from './DevApp'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  </React.StrictMode>,
)
