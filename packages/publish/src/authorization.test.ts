import { describe, expect, test } from 'bun:test'
import {
  PUBLISH_AUTHORIZATION_HEADER,
  PublishNotAuthorizedError,
  publishAuthorizationHeaders,
  runAuthorizePublish,
  type PublishAuthorizationRequest,
} from './authorization'

const request = {
  item: { seedLocalId: 'seed1234567' },
  seedLocalId: 'seed1234567',
  publishMode: 'patch',
  payment: {
    sender: 'wallet',
    gas: { payer: 'user' },
    storage: { payer: 'operator', path: 'bundler', uploadTo: 'upload-api' },
  },
  getEstimate: async () => {
    throw new Error('not called')
  },
} as unknown as PublishAuthorizationRequest

describe('runAuthorizePublish', () => {
  test('no hook approves', async () => {
    expect(await runAuthorizePublish(undefined, request)).toEqual({})
  })
  test('true or nothing approves without a token', async () => {
    expect(await runAuthorizePublish(() => true, request)).toEqual({})
    expect(await runAuthorizePublish(() => undefined, request)).toEqual({})
  })
  test('a token is kept', async () => {
    expect(await runAuthorizePublish(async () => ({ token: 'abc' }), request)).toEqual({ token: 'abc' })
  })
  test('an empty token is dropped', async () => {
    expect(await runAuthorizePublish(() => ({ token: '' }), request)).toEqual({})
  })
  test('false refuses', async () => {
    const error = await runAuthorizePublish(() => false, request).catch((e) => e)
    expect(error).toBeInstanceOf(PublishNotAuthorizedError)
    expect(error.message).toContain('seed1234567')
  })
  test('a throwing hook refuses, keeping its error as the cause', async () => {
    const cause = new Error('card declined')
    const error = await runAuthorizePublish(() => {
      throw cause
    }, request).catch((e) => e)
    expect(error).toBeInstanceOf(PublishNotAuthorizedError)
    expect(error.cause).toBe(cause)
    expect(error.message).toContain('card declined')
  })
  test('the hook gets the request, and the estimate only when it asks', async () => {
    let seen: PublishAuthorizationRequest | undefined
    await runAuthorizePublish((r) => {
      seen = r
      return true
    }, request)
    expect(seen?.payment.gas.payer).toBe('user')
  })
})

describe('publishAuthorizationHeaders', () => {
  test('sends the token in the authorization header', () => {
    expect(publishAuthorizationHeaders({ token: 't' })).toEqual({ [PUBLISH_AUTHORIZATION_HEADER]: 't' })
  })
  test('no token, no header', () => {
    expect(publishAuthorizationHeaders(undefined)).toEqual({})
    expect(publishAuthorizationHeaders({})).toEqual({})
  })
})
