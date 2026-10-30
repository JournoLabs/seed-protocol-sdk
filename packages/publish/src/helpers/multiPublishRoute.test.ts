import { afterEach, describe, expect, mock, test } from 'bun:test'
import { HttpRequestError, zeroAddress } from 'viem'

const TARGET = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const EXTENSION = '0xde5f3133d9a4a4957ad44b4c8d44d0cfaf0a4a6b'

/** Selector → implementation, as the account's Router reports them. */
let routes: Record<string, string> = {}
let code = '0x'
const readContract = mock(async ({ args }: { args: [string] }) => routes[args[0]] ?? zeroAddress)
const getCode = mock(async () => code)
mock.module('./chainClient', () => ({
  getPublishPublicClient: () => ({ readContract, getCode }),
}))

const { assertMultiPublishRouted, MULTI_PUBLISH_SELECTOR } = await import('./multiPublishRoute')

afterEach(() => {
  routes = {}
  code = '0x'
  readContract.mockClear()
})

test('the selector is the three-phase multiPublish', () => {
  expect(MULTI_PUBLISH_SELECTOR).toBe('0xa1263421')
})

describe('assertMultiPublishRouted: a ManagedAccount', () => {
  test('passes when the account routes the selector', async () => {
    routes = { '0xa1263421': EXTENSION }
    await expect(assertMultiPublishRouted(TARGET, { executorModule: false })).resolves.toBeUndefined()
  })

  test('names a version mismatch when it routes only the older multiPublish', async () => {
    routes = { '0x2a29fadc': EXTENSION }
    await expect(assertMultiPublishRouted(TARGET, { executorModule: false })).rejects.toMatchObject({
      code: 'MULTI_PUBLISH_NOT_ROUTED',
      message: expect.stringMatching(/no multiPublish 0xa1263421.*it has 0x2a29fadc.*different versions; nothing was sent/),
    })
  })

  test('passes when the route cannot be read', async () => {
    readContract.mockImplementationOnce(async () => {
      throw new HttpRequestError({ url: 'http://rpc' })
    })
    await expect(assertMultiPublishRouted(TARGET, { executorModule: false })).resolves.toBeUndefined()
  })
})

describe('assertMultiPublishRouted: the executor module', () => {
  test('passes when its bytecode holds the selector', async () => {
    code = '0x6080604052' + '63a1263421' + '14'
    await expect(assertMultiPublishRouted(TARGET, { executorModule: true })).resolves.toBeUndefined()
  })

  test('names a version mismatch when it holds only the older selector', async () => {
    code = '0x6080604052' + '632a29fadc' + '14'
    await expect(assertMultiPublishRouted(TARGET, { executorModule: true })).rejects.toMatchObject({
      code: 'MULTI_PUBLISH_NOT_ROUTED',
      message: expect.stringContaining('The executor module'),
    })
  })

  test('passes when there is no code to check', async () => {
    await expect(assertMultiPublishRouted(TARGET, { executorModule: true })).resolves.toBeUndefined()
  })
})
