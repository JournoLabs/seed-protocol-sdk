import { createHash } from 'node:crypto'
import { entropyToMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { describe, expect, it } from 'vitest'
import {
  EnvelopeError,
  buildKeystoreManifest,
  createEncryptionIdentity,
  decryptEnvelope,
  describeKeystoreManifest,
  encryptEnvelope,
  encryptionIdentityFromSecret,
  eoaSignatureMessage,
  eoaSignatureStanza,
  generateEnvelopeId,
  generateEoaSignatureSalt,
  generateFileKey,
  generatePasskeySalt,
  generateRecoveryPhrase,
  openKeystoreManifest,
  parseEnvelopeHeader,
  passkeyStanza,
  recoveryKeyFromPhrase,
  recoveryStanza,
  signKeyBinding,
  verifyKeyBinding,
  unwrapWithSecretKeys,
  wrapFileKey,
  type EnvelopeErrorCode,
  type PasskeyPrfEvaluator,
  type Stanza,
} from '../src/index'
import { encryptEnvelopeWithNonce } from '../src/envelope'
import { wrapFileKeyWithRandomness } from '../src/recipient'
import {
  referenceEoaSignatureStanza,
  referenceIdentity,
  referenceKeyBindingSignature,
  referenceKeystoreFileKey,
  referencePasskeyStanza,
  referenceRecoverySeed,
  referenceXWingStanza,
} from './reference'
import vectorFile from './vectors.json'

const hex = (s: string) => new Uint8Array(Buffer.from(s.replace(/^0x/, ''), 'hex'))
const toHex = (b: Uint8Array) => Buffer.from(b).toString('hex')
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
const v = vectorFile.keystoreVector
const stanza = (s: { type: string; args: string[]; bodyHex: string }): Stanza => ({ type: s.type, args: s.args, body: hex(s.bodyHex) })
const vectorStanzas = [stanza(v.recovery.stanza), stanza(v.passkey.stanza), stanza(v.eoaSignature.stanza)]
const vectorPhrase = entropyToMnemonic(hex(v.recovery.entropyHex), wordlist)

async function vectorManifest(): Promise<Uint8Array> {
  return encryptEnvelopeWithNonce(
    {
      fileKey: hex(v.keystoreFileKeyHex),
      bind: v.bind,
      stanzas: vectorStanzas,
      contentType: 'application/vnd.seedprotocol.identity-secret',
      body: hex(v.identitySecretHex),
    },
    hex(vectorFile.payloadNonceHex),
  )
}

async function expectCode(promise: Promise<unknown>, code: EnvelopeErrorCode) {
  await expect(promise).rejects.toSatisfy((e: unknown) => e instanceof EnvelopeError && e.code === code)
}

/** A stand-in for a passkey: PRF output is HMAC(device secret, salt), as authenticators compute it. */
function fakePasskey(credentialId: Uint8Array, deviceSecret = crypto.getRandomValues(new Uint8Array(32))) {
  const prf = (salt: Uint8Array) => new Uint8Array(createHash('sha256').update(deviceSecret).update(salt).digest())
  const evaluator: PasskeyPrfEvaluator = async (requests) => {
    const match = requests.find((r) => toHex(r.credentialId) === toHex(credentialId))
    return match ? { credentialId, prfOutput: prf(match.salt) } : null
  }
  return { credentialId, prf, evaluator }
}

describe('encryption identity', () => {
  it('derives the vector identity, matching the reference implementation', async () => {
    const identity = await encryptionIdentityFromSecret(hex(v.identitySecretHex))
    expect(identity.keyId).toBe(v.keyId)
    expect(sha256(identity.recipient.publicKey)).toBe(v.xwingPublicKeySha256)
    expect(toHex(identity.tagKey.publicKey)).toBe(v.x25519PublicKeyHex)
    expect(toHex(identity.bindingKey.publicKey)).toBe(v.ed25519PublicKeyHex)
  })

  it('matches the reference implementation on random secrets', async () => {
    for (let i = 0; i < 3; i++) {
      const secret = crypto.getRandomValues(new Uint8Array(32))
      const ours = await encryptionIdentityFromSecret(secret)
      const theirs = await referenceIdentity(Buffer.from(secret))
      expect(ours.keyId).toBe(theirs.keyId)
      expect(Buffer.from(ours.recipient.publicKey).equals(theirs.xwingPublicKey)).toBe(true)
      expect(Buffer.from(ours.tagKey.publicKey).equals(theirs.x25519PublicKey)).toBe(true)
      expect(Buffer.from(ours.bindingKey.publicKey).equals(theirs.ed25519PublicKey)).toBe(true)
    }
  })

  it('creates distinct identities and rejects a secret of the wrong length', async () => {
    const [a, b] = await Promise.all([createEncryptionIdentity(), createEncryptionIdentity()])
    expect(a.keyId).not.toBe(b.keyId)
    await expectCode(encryptionIdentityFromSecret(new Uint8Array(31)), 'BAD_KEYSTORE')
  })
})

describe('key binding', () => {
  const target = { account: v.keyBinding.account, chainId: v.keyBinding.chainId }

  it('signs the vector binding, matching the reference implementation', async () => {
    const identity = await encryptionIdentityFromSecret(hex(v.identitySecretHex))
    expect(toHex(signKeyBinding(identity, target))).toBe(v.keyBinding.signatureHex)
    const secret = crypto.getRandomValues(new Uint8Array(32))
    const random = await encryptionIdentityFromSecret(secret)
    const other = { account: `0x${toHex(crypto.getRandomValues(new Uint8Array(20)))}`, chainId: 10n }
    expect(toHex(signKeyBinding(random, other))).toBe(
      referenceKeyBindingSignature(Buffer.from(secret), random.keyId, other.chainId, other.account).toString('hex'),
    )
  })

  it("verifies only the identity's binding of its own key id to that account and chain", async () => {
    const identity = await encryptionIdentityFromSecret(hex(v.identitySecretHex))
    const other = await createEncryptionIdentity()
    const signature = signKeyBinding(identity, target)
    const binding = { keyId: identity.keyId, bindingPublicKey: identity.bindingKey.publicKey, signature }
    expect(verifyKeyBinding(binding, target)).toBe(true)
    expect(verifyKeyBinding(binding, { account: target.account.toUpperCase().replace('0X', '0x'), chainId: BigInt(target.chainId) })).toBe(true)
    // Copied into another account's registration, or replayed on another chain.
    expect(verifyKeyBinding(binding, { ...target, account: `0x${'11'.repeat(20)}` })).toBe(false)
    expect(verifyKeyBinding(binding, { ...target, chainId: 10 })).toBe(false)
    // Another identity's key id, or another identity's binding key.
    expect(verifyKeyBinding({ ...binding, keyId: other.keyId }, target)).toBe(false)
    expect(verifyKeyBinding({ ...binding, bindingPublicKey: other.bindingKey.publicKey }, target)).toBe(false)
    expect(verifyKeyBinding({ ...binding, signature: new Uint8Array(64) }, target)).toBe(false)
    expect(verifyKeyBinding({ ...binding, signature: new Uint8Array(3) }, target)).toBe(false)
  })
})

describe('recovery phrase', () => {
  it('is 24 words and derives the same key however it is typed', async () => {
    const phrase = generateRecoveryPhrase()
    expect(phrase.split(' ')).toHaveLength(24)
    const key = await recoveryKeyFromPhrase(phrase)
    expect(await recoveryKeyFromPhrase(`  ${phrase.toUpperCase().split(' ').join('\n  ')} `)).toEqual(key)
  })

  it('derives the vector recovery key from the BIP39 vector phrase', async () => {
    expect(vectorPhrase.startsWith('legal winner thank year')).toBe(true)
    expect(sha256((await recoveryKeyFromPhrase(vectorPhrase)).publicKey)).toBe(v.recovery.publicKeySha256)
  })

  it('rejects a mistyped word, a bad checksum and a 12-word phrase', async () => {
    const words = vectorPhrase.split(' ')
    await expectCode(recoveryKeyFromPhrase([...words.slice(0, 23), 'notaword'].join(' ')), 'BAD_RECOVERY_PHRASE')
    await expectCode(recoveryKeyFromPhrase([...words.slice(0, 23), 'abandon'].join(' ')), 'BAD_RECOVERY_PHRASE')
    await expectCode(recoveryKeyFromPhrase(entropyToMnemonic(new Uint8Array(16), wordlist)), 'BAD_RECOVERY_PHRASE')
  })
})

describe('keystore manifest vector', () => {
  it('reproduces the reference manifest', async () => {
    const manifest = await vectorManifest()
    expect(manifest.length).toBe(v.manifestLength)
    expect(sha256(manifest)).toBe(v.manifestSha256)
  })

  it('builds the same passkey and signature stanzas as the reference', async () => {
    const identity = await encryptionIdentityFromSecret(hex(v.identitySecretHex))
    expect(
      await passkeyStanza(identity, { credentialId: hex(v.passkey.credentialIdHex), salt: hex(v.passkey.saltHex), prfOutput: hex(v.passkey.prfOutputHex) }),
    ).toEqual(vectorStanzas[1])
    expect(eoaSignatureMessage(hex(v.eoaSignature.saltHex))).toBe(v.eoaSignature.message)
    expect(await eoaSignatureStanza(identity, { salt: hex(v.eoaSignature.saltHex), signature: v.eoaSignature.signatureHex, acceptWalletKeyRisk: true })).toEqual(vectorStanzas[2])
  })

  it('matches the reference stanzas on random inputs', async () => {
    for (let i = 0; i < 3; i++) {
      const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n))
      const identity = await encryptionIdentityFromSecret(rand(32))
      const fileKey = referenceKeystoreFileKey(Buffer.from(identity.secret))
      const [credentialId, salt, prfOutput] = [rand(20), rand(32), rand(32)]
      const ref = referencePasskeyStanza(fileKey, Buffer.from(credentialId), Buffer.from(salt), Buffer.from(prfOutput))
      const ours = await passkeyStanza(identity, { credentialId, salt, prfOutput })
      expect(ours.args).toEqual(ref.args)
      expect(Buffer.from(ours.body).equals(ref.body)).toBe(true)

      // A low-s signature; the reference takes its first 64 bytes as r || s.
      const signature = Buffer.concat([Buffer.from(rand(32)), Buffer.from([0x3f]), Buffer.from(rand(31)), Buffer.from([27])])
      const refSig = referenceEoaSignatureStanza(fileKey, Buffer.from(salt), signature)
      const oursSig = await eoaSignatureStanza(identity, { salt, signature: `0x${signature.toString('hex')}`, acceptWalletKeyRisk: true })
      expect(Buffer.from(oursSig.body).equals(refSig.body)).toBe(true)

      // The recovery stanza: our recovery key and wrap against hpke-js with the reference seed.
      const entropy = rand(32)
      const randomness = rand(64)
      const recovery = await recoveryKeyFromPhrase(entropyToMnemonic(entropy, wordlist))
      const refRecovery = await referenceXWingStanza(fileKey, referenceRecoverySeed(Buffer.from(entropy)), Buffer.from(randomness))
      expect(Buffer.from(recovery.publicKey).equals(refRecovery.publicKey)).toBe(true)
      const oursRecovery = await wrapFileKeyWithRandomness(new Uint8Array(fileKey), recovery.publicKey, randomness)
      expect(oursRecovery.args).toEqual(refRecovery.stanza.args)
      expect(Buffer.from(oursRecovery.body).equals(refRecovery.stanza.body)).toBe(true)
      expect(await recoveryStanza(identity, recovery.publicKey)).toSatisfy((s: Stanza) => s.type === 'mlkem768x25519')
    }
  })

  it('opens with the recovery phrase, the passkey and the signature', async () => {
    const manifest = await vectorManifest()
    const unlocks = [
      { recoveryPhrase: vectorPhrase },
      { passkey: async () => ({ credentialId: hex(v.passkey.credentialIdHex), prfOutput: hex(v.passkey.prfOutputHex) }) },
      { signMessage: async (message: string) => (message === v.eoaSignature.message ? v.eoaSignature.signatureHex : '0x' + '00'.repeat(65)) },
    ]
    for (const unlock of unlocks) {
      const identity = await openKeystoreManifest(manifest, unlock, { expectKeyId: v.keyId })
      expect(toHex(identity.secret)).toBe(v.identitySecretHex)
    }
  })

  it('opens with the signature however the wallet encodes v and s', async () => {
    const manifest = await vectorManifest()
    const sig = v.eoaSignature.signatureHex.slice(2)
    const r = sig.slice(0, 64)
    const s = BigInt(`0x${sig.slice(64, 128)}`)
    const n = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n
    const variants = [
      `0x${r}${sig.slice(64, 128)}00`, // v as 0/1
      `0x${r}${(n - s).toString(16).padStart(64, '0')}1c`, // high s
      `0x${r}${(s | (1n << 255n)).toString(16).padStart(64, '0')}`, // EIP-2098 compact
    ]
    for (const signature of variants) {
      const identity = await openKeystoreManifest(manifest, { signMessage: async () => signature })
      expect(identity.keyId).toBe(v.keyId)
    }
  })

  it('describes its authenticators without decrypting', async () => {
    expect(describeKeystoreManifest(await vectorManifest())).toEqual({
      keyId: v.keyId,
      authenticators: [
        { type: 'recovery' },
        { type: 'passkey', credentialId: hex(v.passkey.credentialIdHex) },
        { type: 'eoa-signature', salt: hex(v.eoaSignature.saltHex) },
      ],
    })
  })
})

describe('openKeystoreManifest', () => {
  it('round-trips a new identity and adds a device without the phrase', async () => {
    const identity = await createEncryptionIdentity()
    const phrase = generateRecoveryPhrase()
    const laptop = fakePasskey(crypto.getRandomValues(new Uint8Array(20)))
    const laptopSalt = generatePasskeySalt()
    const first = await buildKeystoreManifest(identity, [
      await recoveryStanza(identity, (await recoveryKeyFromPhrase(phrase)).publicKey),
      await passkeyStanza(identity, { credentialId: laptop.credentialId, salt: laptopSalt, prfOutput: laptop.prf(laptopSalt) }),
    ])

    // The laptop unlocks and adds the phone's passkey, copying the existing stanzas.
    const unlocked = await openKeystoreManifest(first, { passkey: laptop.evaluator })
    const phone = fakePasskey(crypto.getRandomValues(new Uint8Array(20)))
    const phoneSalt = generatePasskeySalt()
    const second = await buildKeystoreManifest(unlocked, [
      ...parseEnvelopeHeader(first).stanzas,
      await passkeyStanza(unlocked, { credentialId: phone.credentialId, salt: phoneSalt, prfOutput: phone.prf(phoneSalt) }),
    ])

    for (const unlock of [{ recoveryPhrase: phrase }, { passkey: laptop.evaluator }, { passkey: phone.evaluator }]) {
      expect((await openKeystoreManifest(second, unlock)).keyId).toBe(identity.keyId)
    }
    expect(parseEnvelopeHeader(second).bind.envelopeId).not.toBe(parseEnvelopeHeader(first).bind.envelopeId)
  })

  it('fails with NO_KEY for another phrase, an unknown passkey, a cancelled prompt or another signer', async () => {
    const identity = await createEncryptionIdentity()
    const salt = generateEoaSignatureSalt()
    const passkey = fakePasskey(crypto.getRandomValues(new Uint8Array(20)))
    const passkeySalt = generatePasskeySalt()
    const manifest = await buildKeystoreManifest(identity, [
      await recoveryStanza(identity, (await recoveryKeyFromPhrase(generateRecoveryPhrase())).publicKey),
      await passkeyStanza(identity, { credentialId: passkey.credentialId, salt: passkeySalt, prfOutput: passkey.prf(passkeySalt) }),
      await eoaSignatureStanza(identity, { salt, signature: `0x${'ab'.repeat(64)}1b`, acceptWalletKeyRisk: true }),
    ])
    await expectCode(openKeystoreManifest(manifest, { recoveryPhrase: generateRecoveryPhrase() }), 'NO_KEY')
    await expectCode(openKeystoreManifest(manifest, { passkey: fakePasskey(passkey.credentialId).evaluator }), 'NO_KEY')
    await expectCode(openKeystoreManifest(manifest, { passkey: async () => null }), 'NO_KEY')
    await expectCode(openKeystoreManifest(manifest, { signMessage: async () => `0x${'cd'.repeat(64)}1b` }), 'NO_KEY')
  })

  it('rejects a manifest for another key id, and an envelope that is not a keystore', async () => {
    const manifest = await vectorManifest()
    await expectCode(openKeystoreManifest(manifest, { recoveryPhrase: vectorPhrase }, { expectKeyId: `0x${'00'.repeat(32)}` }), 'BIND_MISMATCH')
    expect(() => describeKeystoreManifest(hex(vectorFile.vectors[0]!.envelopeHex!))).toThrow(EnvelopeError)
  })

  it('rejects a manifest whose body is another identity than its key id names', async () => {
    const real = await encryptionIdentityFromSecret(hex(v.identitySecretHex))
    const other = await createEncryptionIdentity()
    // Signed with `other`'s keystore file key but claiming `real`'s key id.
    const forged = await buildKeystoreManifest({ ...other, keyId: real.keyId }, [await recoveryStanza(other, (await recoveryKeyFromPhrase(vectorPhrase)).publicKey)])
    await expectCode(openKeystoreManifest(forged, { recoveryPhrase: vectorPhrase }, { expectKeyId: real.keyId }), 'BAD_KEYSTORE')
  })

  it('needs at least one stanza', async () => {
    await expectCode(buildKeystoreManifest(await createEncryptionIdentity(), []), 'BAD_KEYSTORE')
  })

  it('keeps a Version wrapped to the identity readable after recovery', async () => {
    const identity = await createEncryptionIdentity()
    const phrase = generateRecoveryPhrase()
    const manifest = await buildKeystoreManifest(identity, [await recoveryStanza(identity, (await recoveryKeyFromPhrase(phrase)).publicKey)])
    const fileKey = generateFileKey()
    const version = await encryptEnvelope({
      fileKey,
      bind: { envelopeId: generateEnvelopeId() },
      stanzas: [await wrapFileKey(fileKey, identity.recipient.publicKey)],
      contentType: 'text/plain',
      body: new TextEncoder().encode('mine'),
    })
    const recovered = await openKeystoreManifest(manifest, { recoveryPhrase: phrase })
    const opened = await decryptEnvelope(version, { unwrap: unwrapWithSecretKeys([recovered.recipient.secretKey]) })
    expect(new TextDecoder().decode(opened.body)).toBe('mine')
  })
})

describe('eoa-signature stanza', () => {
  it('is built only when the caller accepts that the wallet key opens the identity', async () => {
    const identity = await createEncryptionIdentity()
    const input = { salt: generateEoaSignatureSalt(), signature: `0x${'ab'.repeat(64)}1b` }
    await expectCode(eoaSignatureStanza(identity, input as never), 'BAD_KEYSTORE')
    await expectCode(eoaSignatureStanza(identity, { ...input, acceptWalletKeyRisk: false } as never), 'BAD_KEYSTORE')
    expect((await eoaSignatureStanza(identity, { ...input, acceptWalletKeyRisk: true })).type).toBe('eoa-signature')
  })
})
