import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { setConfigRef } from '../config'
import {
  clearInAppPublishSession,
  disconnectPublishWallet,
  markPublishWalletConnected,
  syncPublishInAppAuthToken,
} from './thirdweb'

/** In-memory Web Storage; bun has no localStorage or sessionStorage. */
function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  }
}

const CLIENT_ID = 'test-client'
const BARE_KEY = `walletToken-${CLIENT_ID}`
const PREFIXED_KEY = `seedProtocol:inAppPublish:${BARE_KEY}`
const g = globalThis as Record<string, unknown>

beforeEach(() => {
  g.window = globalThis
  g.localStorage = memoryStorage()
  g.sessionStorage = memoryStorage()
  setConfigRef({ uploadApiBaseUrl: 'https://example.com', thirdwebClientId: CLIENT_ID })
})

afterEach(() => {
  setConfigRef(null)
  delete g.window
  delete g.localStorage
  delete g.sessionStorage
})

/** A signed-in in-app wallet whose token the sync has copied to thirdweb's default key. */
function signIn(token: string) {
  localStorage.setItem(PREFIXED_KEY, token)
  syncPublishInAppAuthToken()
  expect(localStorage.getItem(BARE_KEY)).toBe(token)
}

/** thirdweb's in-app `logout()` removes only the key in the wallet's own storage. */
function thirdwebLogout() {
  localStorage.removeItem(PREFIXED_KEY)
}

describe('disconnecting the publish wallet', () => {
  test('a later sync does not restore the session, and no token is left behind', async () => {
    signIn('jwt-1')
    thirdwebLogout()
    await disconnectPublishWallet()

    syncPublishInAppAuthToken()

    expect(localStorage.getItem(PREFIXED_KEY)).toBeNull()
    expect(localStorage.getItem(BARE_KEY)).toBeNull()
  })

  test('a bare token written after disconnect is not copied back while the user stays disconnected', async () => {
    signIn('jwt-1')
    thirdwebLogout()
    await disconnectPublishWallet()
    localStorage.setItem(BARE_KEY, 'jwt-stale')

    syncPublishInAppAuthToken()

    expect(localStorage.getItem(PREFIXED_KEY)).toBeNull()
  })

  test('after a fresh connect the sync restores the session again', async () => {
    signIn('jwt-1')
    thirdwebLogout()
    await disconnectPublishWallet()

    markPublishWalletConnected()
    signIn('jwt-2')
    thirdwebLogout()
    syncPublishInAppAuthToken()

    expect(localStorage.getItem(PREFIXED_KEY)).toBe('jwt-2')
  })
})

describe('clearInAppPublishSession', () => {
  test('removes the prefixed keys, the default token key and the disconnect flag; other keys stay', async () => {
    signIn('jwt-1')
    localStorage.setItem('seedProtocol:inAppPublish:thirdwebEwsWalletUserId-test-client', 'user-1')
    localStorage.setItem('app:theme', 'dark')
    sessionStorage.setItem('seedProtocol:publish:userChoseWalletDisconnect', '1')

    await clearInAppPublishSession()

    expect(localStorage.getItem(PREFIXED_KEY)).toBeNull()
    expect(localStorage.getItem(BARE_KEY)).toBeNull()
    expect(localStorage.getItem('seedProtocol:inAppPublish:thirdwebEwsWalletUserId-test-client')).toBeNull()
    expect(sessionStorage.getItem('seedProtocol:publish:userChoseWalletDisconnect')).toBeNull()
    expect(localStorage.getItem('app:theme')).toBe('dark')
  })

  test('a later sync has nothing to restore', async () => {
    signIn('jwt-1')
    await clearInAppPublishSession()

    syncPublishInAppAuthToken()

    expect(localStorage.getItem(PREFIXED_KEY)).toBeNull()
    expect(localStorage.getItem(BARE_KEY)).toBeNull()
  })

  test('removes the prefixed keys before publish is configured', async () => {
    localStorage.setItem(PREFIXED_KEY, 'jwt-1')
    setConfigRef(null)

    await clearInAppPublishSession()

    expect(localStorage.getItem(PREFIXED_KEY)).toBeNull()
  })
})
