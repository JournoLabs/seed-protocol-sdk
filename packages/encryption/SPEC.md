# seed-private/v1

The byte format of an encrypted upload for a Seed Protocol private Version. A reader that has the
32-byte file key can decrypt an envelope with this document alone, without the SDK. The design
follows [age](https://github.com/C2SP/C2SP/blob/main/age.md): a text header of recipient stanzas
authenticated by an HMAC, then a STREAM payload of independently authenticated chunks. It differs
from age in the key size, the cipher, the `bind` line and the content frame. ADR 0033 records why.

Status: draft. Defined so far: the `mlkem768x25519` recipient stanza, the encryption identity and
its key binding, and the keystore manifest with its `passkey-prf` and `eoa-signature` stanzas. Stanza types for readers'
key grants and subscription epochs come with those features.

## Notation

`||` is concatenation. `HKDF(ikm, salt, info, L)` is HKDF-SHA-256 (RFC 5869) with output length `L`
bytes. `HMAC(key, msg)` is HMAC-SHA-256. Strings are ASCII unless stated. `base64` is the standard
alphabet (RFC 4648 section 4) without padding, and a decoder must reject padding, characters outside
the alphabet, and non-zero trailing bits.

## Keys

- **File key:** 32 random bytes, generated per private Version. Each stanza wraps it for one
  recipient. The publisher's own wrap is always present.
- **Header MAC key:** `HKDF(file key, empty, "seed-private/v1/header", 32)`.
- **Payload key:** `HKDF(file key, payload nonce, "seed-private/v1/payload" || 0x00 || bind, 32)`,
  where `bind` is the canonical bind JSON's UTF-8 bytes and the payload nonce is 16 random bytes
  written at the start of the payload.

## Header

```
seed-private/v1
bind <base64(bind)>
-> <type> [<arg> ...]
<base64 body, 64 characters per line; the last line is shorter, possibly empty>
...more stanzas...
--- <base64(MAC)>
```

Every line ends with a single LF. Header lines are printable ASCII (0x20 to 0x7E).

**Version line.** Exactly `seed-private/v1`. Readers detect an envelope by this line and its LF.

**Bind line.** The canonical bind JSON: an object whose keys match `[A-Za-z][A-Za-z0-9]*`, whose
values are strings, with keys sorted by UTF-16 code unit and no whitespace, serialized as
`JSON.stringify` does. The key `envelopeId` is required: `0x` followed by 64 lowercase hex digits,
chosen before encryption and recorded in the Version's envelope attestation. Other keys (for
example `chainId`, `publisher`, `seed`, `version`) are values known before upload. A reader must
reject a bind that does not re-serialize to the same bytes, and should compare the values it expects
from the attestation before using the content.

**Stanzas.** At least one. The stanza line is `-> `, a type, and zero or more arguments, separated
by single spaces; the type and each argument are one or more characters from 0x21 to 0x7E. The body
is base64 wrapped at 64 characters; the body ends at the first line shorter than 64 characters, so
a body whose encoding is a multiple of 64 characters is followed by an empty line. A reader ignores
stanza types it doesn't know. The type `x-test` appears only in test vectors.

**MAC line.** `--- ` and the base64 of `HMAC(header MAC key, header bytes from the start through
"---")`. The MAC covers the version line, the bind line, every stanza and the three dashes, not the
space or the MAC itself. A reader must verify it, in constant time, before decrypting the payload.

## Recipient stanzas

### mlkem768x25519

The file key sealed with HPKE (RFC 9180) to an X-Wing public key. The publisher's own wrap and the
recovery wrap are both this type, each to its own key. The construction follows age's
`mlkem768x25519` recipient ([c2sp.org/age](https://c2sp.org/age)) with a different `info`
string, a 32-byte file key and AES-256-GCM.

**Keys.** The secret key is 32 random bytes. The public key is the 1216-byte X-Wing encapsulation
key derived from it (draft-connolly-cfrg-xwing-kem, the KEM that draft-ietf-hpke-pq calls
MLKEM768-X25519): the ML-KEM-768 encapsulation key followed by the X25519 public key.

**Wrapping.** `enc, ct = SealBase(pkR = public key, info = "seed-private/v1/mlkem768x25519",
aad = "", pt = file key)` with this suite:

| | Algorithm | Id |
|---|---|---|
| KEM | MLKEM768-X25519 (X-Wing) | `0x647a` |
| KDF | HKDF-SHA256 | `0x0001` |
| AEAD | AES-256-GCM | `0x0002` |

The stanza is `-> mlkem768x25519 <base64(enc)>` with `ct` as its body. `enc` is 1120 bytes (the
ML-KEM-768 ciphertext, then the X25519 ephemeral key) and `ct` is 48 bytes. Every wrap uses fresh
encapsulation randomness.

**Unwrapping.** A reader with a secret key computes `OpenBase(enc, skR, info, "", ct)`. A stanza
of this type with other than one argument, an argument that isn't canonical base64 of 1120 bytes,
or a body that isn't 48 bytes is malformed, and decryption fails. A body that doesn't authenticate
means the stanza was wrapped to another key; the reader tries the next stanza. Readers try every
`mlkem768x25519` stanza, since the header doesn't say which key each one is for.

## Identity

A user's encryption identity is one **identity secret** of 32 random bytes. Everything else is
derived from it:

- **Recipient key:** the `mlkem768x25519` key pair whose secret key is
  `HKDF(identity secret, empty, "seed-private/v1/identity/mlkem768x25519", 32)`. Version file keys
  are wrapped to its public key.
- **Tag key:** the X25519 key pair whose private key is
  `HKDF(identity secret, empty, "seed-private/v1/identity/x25519", 32)` (RFC 7748 clamping applies
  when it is used). It is reserved for blinded tags.
- **Binding key:** the Ed25519 key pair (RFC 8032) whose 32-byte private key is
  `HKDF(identity secret, empty, "seed-private/v1/identity/ed25519", 32)`. It signs key bindings
  and nothing else.
- **Key id:** `0x` and the lowercase hex of `SHA-256("seed-private/v1/key-id" || 0x00 || recipient
  public key || tag public key || binding public key)`.

**Key binding.** An account that registers an identity also publishes the binding key's Ed25519
signature over

```
"seed-private/v1/key-binding" || 0x00 || key id (32 bytes) || chain id (32 bytes, big-endian) || account (20 bytes)
```

where the account is the registering account's address and the chain id is the chain the
registration is on. A reader accepts a registration only when the key id matches the three public
keys and the signature verifies for the registration's attester and chain. Without it, an account
could register another identity's public keys as its own, and content shared with that account
would be readable by the other identity instead. The X-Wing and X25519 keys can't sign, so the
binding key signs for them; the key id commits to all three.

**Recovery key.** A recovery phrase is 24 words from the BIP39 English list encoding 32 bytes of
entropy with BIP39's checksum. Readers compare words after NFKD normalization, lowercasing and
collapsing whitespace, and reject unknown words, a bad checksum and any other length. The recovery
key is the `mlkem768x25519` key pair whose secret key is
`HKDF(entropy, empty, "seed-private/v1/recovery/mlkem768x25519", 32)`. BIP39's PBKDF2 seed is not
used, so a wallet's phrase entered by mistake gives an unrelated key.

## Keystore manifest

The keystore manifest lets any authenticator the user enrolled recover the identity secret. It is a
`seed-private/v1` envelope with:

- **file key** `HKDF(identity secret, empty, "seed-private/v1/keystore", 32)`. It depends only on
  the identity, so a device that holds the identity can write a revised manifest that copies the
  existing stanzas unchanged and adds one;
- **bind** `{"envelopeId": <random per revision>, "keyId": <the key id>, "purpose": "keystore"}`;
- **content type** `application/vnd.seedprotocol.identity-secret` and the 32-byte identity secret
  as the body;
- **one or more stanzas**, each of a type below.

The manifest is public, so a stanza may hold nothing that identifies the user beyond their account.
A reader that opens a manifest must check that the identity derived from the body has the bind's
key id, and that its keystore file key equals the one the stanza unwrapped; when it knows the key id
from the registration attestation it must also check the bind against it.

**Recovery stanza.** An `mlkem768x25519` stanza wrapping the keystore file key to the recovery
public key. Writing it needs only the public key, not the phrase.

**`passkey-prf`.** `-> passkey-prf <base64(credential id)> <base64(salt)>`, where the salt is 32
random bytes, with a 48-byte body `AES-256-GCM(KEK, nonce = 12 zero bytes, aad = "", file key)` and
`KEK = HKDF(PRF output, salt, "seed-private/v1/passkey-prf", 32)`. The PRF output is the WebAuthn
`prf` extension's `results.first` for the credential with `eval.first = salt`. A reader with
several `passkey-prf` stanzas asks for any of their credentials in one request, using
`evalByCredential`.

**`eoa-signature`.** Writers should offer this stanza only when the user chooses it over a passkey,
because it makes the identity no stronger than the EOA's secp256k1 key: anyone who has that key can
produce the signature below and open the public manifest, which reveals every private Version
wrapped to the identity. That includes a future attacker who recovers the key from the public key
any of the account's transactions expose. `-> eoa-signature <base64(salt)>`, with a 32-byte random salt and the same
body construction, with `KEK = HKDF(r || s, salt, "seed-private/v1/eoa-signature", 32)`. `r || s`
are the 64 bytes of the account's EIP-191 `personal_sign` signature over the message below, with
`s` replaced by `n - s` when it is above `n / 2` (`n` the secp256k1 order), and with the parity bit
cleared when the signature is in EIP-2098 compact form. `v` is not used. Only EOAs whose wallets
sign deterministically (RFC 6979) can use this stanza. The message, with LF line endings and the
salt as `0x` and lowercase hex:

```
Unlock your Seed Protocol encryption key

Signing this message lets this app read your private Versions. Anyone who gets this signature can read them too, so sign it only in apps you trust.

Key: 0x<salt>
```

A zero nonce is safe in both stanzas because each KEK is used for one encryption: it depends on a
fresh random salt.

## Payload

The payload follows the MAC line's LF: the 16-byte payload nonce, then the chunks.

The plaintext is the content frame: a 4-byte big-endian length `n`, then `n` bytes of UTF-8 JSON
`{"bodyLength":<integer>,"contentType":"<MIME type>"}`, then `bodyLength` bytes of content, then
zero bytes of padding. The real content type is only here, never in the header or in upload tags.
`n` must not exceed 65536. A reader must reject a frame whose `bodyLength` is not a non-negative
integer, runs past the end of the plaintext, or is followed by a non-zero byte.

**Padding.** Writers should pad by default, so the ciphertext size shows a size class rather than
the exact length. Seed writers pad the frame's total length `L` (the 4 length bytes, the JSON and
the content) to PADMÉ(`L`): with `E = floor(log2 L)` and `S = floor(log2 E) + 1`, round `L` up to a
multiple of `2^(E - S)`. That adds at most 12%. `L` below 2 is left as is. A writer may skip
padding; readers handle both the same way.

The plaintext is split into 64 KiB (65536-byte) chunks. Every chunk but the last is full-size. The
last chunk is non-empty, unless it is the only chunk. Chunk `i` (from 0) is encrypted with
AES-256-GCM under the payload key, no associated data, and the 12-byte nonce `i` as an 11-byte
big-endian integer followed by `0x01` for the last chunk and `0x00` otherwise. Each sealed chunk is
the ciphertext followed by its 16-byte tag, so a non-final sealed chunk is 65552 bytes.

A reader decrypting chunk by chunk treats a chunk as the last when 65552 or fewer bytes remain. It
must fail when:

- a chunk does not authenticate;
- the payload ends after a full-size non-final chunk (truncated);
- bytes follow a full-size chunk that authenticates as final (trailing data);
- the last chunk is empty and is not the only chunk.

Bytes appended after a short final chunk make that chunk fail to authenticate, so they are reported
as a bad chunk. A reader must not release plaintext from a payload that later fails, unless it
tells its caller the content is incomplete.

## Uploads

An envelope is uploaded with `Content-Type: application/octet-stream` and the tag
`Seed-Encryption: seed-private/v1`. `Content-SHA-256` is the SHA-256 of the envelope bytes.

## Test vectors

`__tests__/vectors.json` lists inputs and the resulting envelopes: the hex for envelopes up to
4096 bytes, and the length and SHA-256 for all. All vectors use file key `00 01 ... 1f` and payload
nonce `a0 a1 ... af`, and each names its `padding` (`padme` or `none`). They were produced by
`__tests__/reference.ts`, a node:crypto implementation that shares no code with `src/`. The cases
cover a short text, an empty body with two stanzas and a stanza body that fills a whole line, an
unpadded plaintext of exactly one chunk and of one chunk plus one byte, and a 200000-byte body
padded to four chunks. `__tests__/envelope.test.ts` lists the failure cases above as tests.

`recipientVectors` gives two `mlkem768x25519` stanzas, wrapping the same file key, each with its
recipient seed, the SHA-256 of the public key and the 64 bytes of encapsulation randomness (the
first 32 for ML-KEM, the last 32 for the X25519 ephemeral key). `recipientEnvelope` is an
envelope carrying both. These stanzas were produced with hpke-js (`@hpke/core`,
`@hpke/hybridkem-x-wing`), which shares no code with `src/`; `__tests__/recipient.test.ts` also
checks the X-Wing KEM against the draft's first test vector.

`keystoreVector` is a keystore manifest built by the reference with its derived file key and the
same payload nonce. It lists the identity secret, its derived public keys and key id, the keystore
file key, one stanza of each type with its inputs, and `keyBinding`: the binding signature for an
account and chain id. The recovery entropy is BIP39's test vector `7f7f...7f` ("legal winner thank year ..."), and the
signature is from secp256k1 private key `77 77 ... 77`.
