import { client }                              from "@/client"
import { beforeEach, describe, it, } from "vitest"
import config                                  from '@/test/__mocks__/node/project/schema'
import { ClientManager }                       from '@/client/ClientManager'
import { CLIENT_NOT_INITIALIZED }        from '@/helpers/constants'


describe('Client in node', () => {
  let testConfig = Object.assign({}, config)
  let testClient: typeof ClientManager | undefined

  beforeEach(async () => {
    testClient = Object.assign({}, client)
  })

  testConfig.endpoints = {
      files: './__tests__/__mocks__/node/project/.seed',
      filePaths: 'api/seed/migrations',
    }

  it.concurrent('initializes properly with one address', async ({expect}) => {
    expect(testClient).toBeDefined()
    expect(testClient!.isInitialized()).toBe(false)
    if (!testClient) {  return }
    await testClient.init({
      config: testConfig,
      addresses: [
        '0x1234567890123456789012345678901234567890',
      ],
    })
    expect(testClient.isInitialized()).toBe(true)
  }, 30000)

  it.concurrent('initializes properly with multiple addresses', async ({expect}) => {
    expect(testClient).toBeDefined()
    expect(testClient!.isInitialized()).toBe(false)
    if (!testClient) {  return }
    await testClient.init({
      config: testConfig,
      addresses: [
        '0x1234567890123456789012345678901234567890',
        '0x1234567890123456789012345678901234567891',
        '0x1234567890123456789012345678901234567892',
      ],
    })
    expect(client.isInitialized()).toBe(true)
  }, 30000)

  it.concurrent('initializes properly with no addresses', async ({expect}) => {
    expect(testClient).toBeDefined()
    expect(testClient!.isInitialized()).toBe(false)
    if (!testClient) {  return }
    await testClient.init({
      config: testConfig,
      addresses: [],
    })
    expect(testClient.isInitialized()).toBe(true)
  }, 30000)

  it.concurrent('properly sets addresses after initialization', async ({expect}) => {
    expect(testClient).toBeDefined()
    expect(testClient!.isInitialized()).toBe(false)
    if (!testClient) {  return }
    await testClient.init({
      config: testConfig,
      addresses: [],
    })
    const addresses = ['0x1234567890123456789012345678901234567890']
    await testClient.setAddresses(addresses)
    const retrievedAddresses = await testClient.getAddresses()
    expect(retrievedAddresses).toEqual(addresses)
  }, 20000)

  it.concurrent('throws an error if any method other than init is called before initialization', async ({expect}) => {
    expect(testClient).toBeDefined()
    expect(testClient!.isInitialized()).toBe(false)
    if (!testClient) { return }

    const addresses = ['0x1234567890123456789012345678901234567890']

    
    await expect(testClient.setAddresses(addresses)).rejects.toThrow(CLIENT_NOT_INITIALIZED)
    await expect(testClient.getAddresses()).rejects.toThrow(CLIENT_NOT_INITIALIZED)
  }, 20000)
})
