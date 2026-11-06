import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EnvelopeError, buildKeystoreManifest, createEncryptionIdentity, enrollPasskey, openKeystoreManifest, passkeyPrf } from '../src/index'

const b64url = (b: Uint8Array) => Buffer.from(b).toString('base64url')

/**
 * A fake WebAuthn authenticator at the navigator.credentials boundary. PRF output is
 * HMAC(credential secret, salt), the shape of CTAP2 hmac-secret.
 */
function installAuthenticator({ prf = true }: { prf?: boolean } = {}) {
  const credentials = new Map<string, Buffer>()
  const calls: { create: CredentialCreationOptions[]; get: CredentialRequestOptions[] } = { create: [], get: [] }
  const result = (rawId: Uint8Array, ext: AuthenticationExtensionsClientOutputs) =>
    ({ rawId: rawId.buffer.slice(rawId.byteOffset, rawId.byteOffset + rawId.byteLength), getClientExtensionResults: () => ext }) as unknown as PublicKeyCredential
  const fake = {
    async create(options: CredentialCreationOptions) {
      calls.create.push(options)
      const id = crypto.getRandomValues(new Uint8Array(16))
      credentials.set(b64url(id), Buffer.from(crypto.getRandomValues(new Uint8Array(32))))
      return result(id, { prf: { enabled: prf } })
    },
    async get(options: CredentialRequestOptions) {
      calls.get.push(options)
      const allowed = options.publicKey!.allowCredentials!.map((c) => b64url(new Uint8Array(c.id as ArrayBuffer | Uint8Array)))
      const id = allowed.find((a) => credentials.has(a))
      if (!id) return null
      const salt = options.publicKey!.extensions!.prf!.evalByCredential![id]!.first as Uint8Array
      const first = createHmac('sha256', credentials.get(id)!).update(salt).digest()
      return result(new Uint8Array(Buffer.from(id, 'base64url')), prf ? { prf: { results: { first: new Uint8Array(first) } } } : {})
    },
  }
  vi.stubGlobal('navigator', { credentials: fake })
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('passkey enrollment and unlock', () => {
  it('enrolls a passkey and unlocks the manifest with it', async () => {
    const calls = installAuthenticator()
    const identity = await createEncryptionIdentity()
    const stanza = await enrollPasskey(identity, { rpName: 'Example', userName: 'reader@example.com' })
    const manifest = await buildKeystoreManifest(identity, [stanza])
    expect((await openKeystoreManifest(manifest, { passkey: passkeyPrf() })).keyId).toBe(identity.keyId)
    expect(calls.create[0]!.publicKey!.authenticatorSelection!.userVerification).toBe('required')
    expect(calls.get).toHaveLength(2)
  })

  it('fails with NO_KEY when this device has none of the passkeys', async () => {
    installAuthenticator()
    const identity = await createEncryptionIdentity()
    const manifest = await buildKeystoreManifest(identity, [await enrollPasskey(identity, { rpName: 'Example', userName: 'a' })])
    installAuthenticator()
    await expect(openKeystoreManifest(manifest, { passkey: passkeyPrf() })).rejects.toSatisfy(
      (e: unknown) => e instanceof EnvelopeError && e.code === 'NO_KEY',
    )
  })

  it('reports PASSKEY_PRF_UNSUPPORTED for an authenticator without PRF', async () => {
    installAuthenticator({ prf: false })
    await expect(enrollPasskey(await createEncryptionIdentity(), { rpName: 'Example', userName: 'a' })).rejects.toSatisfy(
      (e: unknown) => e instanceof EnvelopeError && e.code === 'PASSKEY_PRF_UNSUPPORTED',
    )
  })
})
