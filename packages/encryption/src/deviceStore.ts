/**
 * Keeps unlocked identities on this device in IndexedDB, each encrypted with its own
 * non-extractable AES-GCM key stored beside it. That keeps the secret from being read out of the
 * database by copying its files or calling `exportKey`, but any script on the origin can still
 * decrypt it. Don't save an identity on a shared device; unlock it from the keystore manifest
 * each session instead.
 */

import { EnvelopeError } from './envelope'
import { encryptionIdentityFromSecret, type EncryptionIdentity } from './identity'

const DB_NAME = 'seed-encryption'
const STORE = 'identities'

interface DeviceIdentityRecord {
  keyId: string
  deviceKey: CryptoKey
  iv: Uint8Array
  ciphertext: Uint8Array
  savedAt: number
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function openDb(): Promise<IDBDatabase> {
  const req = indexedDB.open(DB_NAME, 1)
  req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'keyId' })
  return request(req)
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, mode)
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
    const result = await request(fn(tx.objectStore(STORE)))
    await done
    return result
  } finally {
    db.close()
  }
}

/** Saves `identity` on this device, replacing an earlier save of the same key id. */
export async function saveIdentityOnDevice(identity: EncryptionIdentity): Promise<void> {
  const deviceKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const aad = new TextEncoder().encode(identity.keyId)
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, deviceKey, new Uint8Array(identity.secret)),
  )
  const record: DeviceIdentityRecord = { keyId: identity.keyId, deviceKey, iv, ciphertext, savedAt: Date.now() }
  await withStore('readwrite', (store) => store.put(record))
}

/** The identity saved under `keyId`, or null when this device has none. */
export async function loadIdentityFromDevice(keyId: string): Promise<EncryptionIdentity | null> {
  const record = (await withStore('readonly', (store) => store.get(keyId))) as DeviceIdentityRecord | undefined
  if (!record) return null
  let secret: Uint8Array
  try {
    secret = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(record.iv), additionalData: new TextEncoder().encode(keyId) },
        record.deviceKey,
        new Uint8Array(record.ciphertext),
      ),
    )
  } catch {
    throw new EnvelopeError('BAD_KEYSTORE', `The identity saved for ${keyId} does not decrypt`)
  }
  const identity = await encryptionIdentityFromSecret(secret)
  if (identity.keyId !== keyId) throw new EnvelopeError('BAD_KEYSTORE', `The identity saved for ${keyId} has another key id`)
  return identity
}

/** Key ids of the identities saved on this device. */
export async function listIdentitiesOnDevice(): Promise<string[]> {
  return (await withStore('readonly', (store) => store.getAllKeys())) as string[]
}

/** Deletes the identity saved under `keyId` from this device. Its keystore manifest is unaffected. */
export async function forgetIdentityOnDevice(keyId: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(keyId))
}
