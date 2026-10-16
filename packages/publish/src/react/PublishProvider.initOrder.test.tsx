import { describe, expect, mock, test } from 'bun:test'
import React from 'react'
import { renderToString } from 'react-dom/server'

// SeedProvider needs a browser; here it only has to render its children.
mock.module('@seedprotocol/react', () => ({
  SeedProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const { default: PublishProvider } = await import('./PublishProvider')
const { getPublishConfig } = await import('../config')

describe('PublishProvider', () => {
  test("initializes the config before its children's first render", () => {
    const Reader = () => <span>{getPublishConfig().uploadApiBaseUrl}</span>
    const html = renderToString(
      <PublishProvider config={{ uploadApiBaseUrl: 'https://upload.example.com' } as never}>
        <Reader />
      </PublishProvider>,
    )
    expect(html).toContain('https://upload.example.com')
  })
})
