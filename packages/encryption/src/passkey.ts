/**
 * WebAuthn calls for the `passkey-prf` keystore stanza. Browser only. The challenges are random and
 * never checked by a server: the passkey is used for its PRF output, not to sign in.
 */

import { EnvelopeError, type Stanza } from './envelope'
import type { EncryptionIdentity } from './identity'
import { generatePasskeySalt, passkeyStanza, type PasskeyPrfEvaluator } from './keystore'

export interface PasskeyOptions {
  /** Defaults to the page's effective domain. A passkey works only on the domain it was made for. */
  rpId?: string
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function toBytes(value: BufferSource): Uint8Array {
  return value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
}

function randomChallenge(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(32))
}

/** A `PasskeyPrfEvaluator` that asks the browser for one of the requested passkeys. */
export function passkeyPrf(options: PasskeyOptions = {}): PasskeyPrfEvaluator {
  return async (requests) => {
    const evalByCredential: Record<string, AuthenticationExtensionsPRFValues> = {}
    for (const r of requests) evalByCredential[base64Url(r.credentialId)] = { first: new Uint8Array(r.salt) }
    const credential = (await navigator.credentials.get({
      publicKey: {
        challenge: randomChallenge(),
        rpId: options.rpId,
        allowCredentials: requests.map((r) => ({ type: 'public-key' as const, id: new Uint8Array(r.credentialId) })),
        userVerification: 'required',
        extensions: { prf: { evalByCredential } },
      },
    })) as PublicKeyCredential | null
    if (!credential) return null
    const first = credential.getClientExtensionResults().prf?.results?.first
    if (!first) throw new EnvelopeError('PASSKEY_PRF_UNSUPPORTED', 'This passkey or browser does not support the PRF extension')
    return { credentialId: new Uint8Array(credential.rawId), prfOutput: toBytes(first) }
  }
}

/**
 * Creates a passkey and returns a keystore stanza for it. Two prompts: one to create the passkey,
 * one to evaluate its PRF. Throws PASSKEY_PRF_UNSUPPORTED when the authenticator has no PRF.
 */
export async function enrollPasskey(
  identity: EncryptionIdentity,
  options: PasskeyOptions & { rpName: string; userName: string },
): Promise<Stanza> {
  const created = (await navigator.credentials.create({
    publicKey: {
      challenge: randomChallenge(),
      rp: { name: options.rpName, id: options.rpId },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: options.userName, displayName: options.userName },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
      extensions: { prf: {} },
    },
  })) as PublicKeyCredential | null
  if (!created) throw new EnvelopeError('PASSKEY_PRF_UNSUPPORTED', 'No passkey was created')
  if (created.getClientExtensionResults().prf?.enabled === false) {
    throw new EnvelopeError('PASSKEY_PRF_UNSUPPORTED', 'This passkey does not support the PRF extension')
  }
  const credentialId = new Uint8Array(created.rawId)
  const salt = generatePasskeySalt()
  const result = await passkeyPrf(options)([{ credentialId, salt }])
  if (!result) throw new EnvelopeError('PASSKEY_PRF_UNSUPPORTED', 'The passkey was not used')
  return passkeyStanza(identity, { credentialId, salt, prfOutput: result.prfOutput })
}
