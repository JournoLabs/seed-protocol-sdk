import { describe, expect, mock, test } from 'bun:test'
import React from 'react'
import { renderToString } from 'react-dom/server'

// SeedProvider needs a browser; here it only renders its children and records its props.
const seedProviderProps: Record<string, unknown>[] = []
mock.module('@seedprotocol/react', () => ({
  SeedProvider: ({ children, ...props }: { children: React.ReactNode }) => {
    seedProviderProps.push(props)
    return <>{children}</>
  },
}))

const { default: PublishProvider } = await import('./PublishProvider')
const { default: PublishProviderThirdweb } = await import('./PublishProvider.thirdweb')
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

  for (const [name, Provider] of [
    ['PublishProvider', PublishProvider],
    ['the thirdweb PublishProvider', PublishProviderThirdweb],
  ] as const) {
    test(`${name} passes the Seed config, addresses and onInitError to SeedProvider (D25)`, () => {
      const seedConfig = { schema: { name: 'Blog' } } as never
      const addresses = { owned: ['0x00000000000000000000000000000000000000aa'] }
      const onInitError = () => {}
      seedProviderProps.length = 0
      renderToString(
        <Provider seedConfig={seedConfig} addresses={addresses} onInitError={onInitError}>
          <span />
        </Provider>,
      )
      expect(seedProviderProps[0]).toMatchObject({ config: seedConfig, addresses, onInitError })
    })
  }
})
