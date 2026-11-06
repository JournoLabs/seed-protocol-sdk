import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import {
  EnvelopeError,
  createEncryptionIdentity,
  forgetIdentityOnDevice,
  listIdentitiesOnDevice,
  loadIdentityFromDevice,
  saveIdentityOnDevice,
} from '../src/index'

describe('identities saved on the device', () => {
  it('saves, lists, loads and forgets an identity', async () => {
    const identity = await createEncryptionIdentity()
    expect(await loadIdentityFromDevice(identity.keyId)).toBeNull()
    await saveIdentityOnDevice(identity)
    expect(await listIdentitiesOnDevice()).toContain(identity.keyId)
    expect(await loadIdentityFromDevice(identity.keyId)).toEqual(identity)
    await forgetIdentityOnDevice(identity.keyId)
    expect(await loadIdentityFromDevice(identity.keyId)).toBeNull()
    expect(await listIdentitiesOnDevice()).not.toContain(identity.keyId)
  })

  it('stores the secret encrypted under a key that cannot be exported', async () => {
    const identity = await createEncryptionIdentity()
    await saveIdentityOnDevice(identity)
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('seed-encryption')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const record = await new Promise<{ deviceKey: CryptoKey; ciphertext: Uint8Array }>((resolve, reject) => {
      const req = db.transaction('identities').objectStore('identities').get(identity.keyId)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    db.close()
    expect(Buffer.from(record.ciphertext).includes(Buffer.from(identity.secret))).toBe(false)
    expect(record.deviceKey.extractable).toBe(false)
    await expect(crypto.subtle.exportKey('raw', record.deviceKey)).rejects.toThrow()
  })

  it('refuses a record moved to another key id', async () => {
    const identity = await createEncryptionIdentity()
    await saveIdentityOnDevice(identity)
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('seed-encryption')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const other = `0x${'ee'.repeat(32)}`
    await new Promise<void>((resolve, reject) => {
      const store = db.transaction('identities', 'readwrite').objectStore('identities')
      const get = store.get(identity.keyId)
      get.onsuccess = () => {
        const put = store.put({ ...get.result, keyId: other })
        put.onsuccess = () => resolve()
        put.onerror = () => reject(put.error)
      }
    })
    db.close()
    await expect(loadIdentityFromDevice(other)).rejects.toSatisfy((e: unknown) => e instanceof EnvelopeError && e.code === 'BAD_KEYSTORE')
  })
})
