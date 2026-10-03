import { afterEach, describe, expect, test } from 'bun:test'
import { BaseArweaveClient } from '@seedprotocol/sdk'
import { getArweave } from './blockchain'

const original = BaseArweaveClient.getBaseUrl()

afterEach(() => {
  BaseArweaveClient.setHost(original)
})

describe('getArweave', () => {
  test('keeps http and the port of a local gateway', () => {
    BaseArweaveClient.setHost('http://localhost:1984')
    expect(getArweave().getConfig().api).toMatchObject({ host: 'localhost', protocol: 'http', port: 1984 })
  })

  test('defaults to https on 443 for a hosted gateway', () => {
    BaseArweaveClient.setHost('https://arweave.net')
    expect(getArweave().getConfig().api).toMatchObject({ host: 'arweave.net', protocol: 'https', port: 443 })
  })
})
