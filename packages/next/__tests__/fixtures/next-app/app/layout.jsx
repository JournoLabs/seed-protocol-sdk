import { SeedProvider } from '@seedprotocol/react'
import { Gate } from './gate'

// A server component importing SeedProvider directly: @seedprotocol/react is a client module.
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <SeedProvider>
          <Gate>{children}</Gate>
        </SeedProvider>
      </body>
    </html>
  )
}
