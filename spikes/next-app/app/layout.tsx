import type { ReactNode } from 'react'
import { SeedProvider } from '@seedprotocol/react'
import { Gate } from './gate'

// SeedProvider comes straight from the package: @seedprotocol/react is a client module,
// so this server component needs no wrapper file for it.
export default function RootLayout({ children }: { children: ReactNode }) {
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
