# seed-private/v1

The byte format of an encrypted upload for a Seed Protocol private Version. A reader that has the
32-byte file key can decrypt an envelope with this document alone, without the SDK. The design
follows [age](https://github.com/C2SP/C2SP/blob/main/age.md): a text header of recipient stanzas
authenticated by an HMAC, then a STREAM payload of independently authenticated chunks. It differs
from age in the key size, the cipher, the `bind` line and the content frame. ADR 0033 records why.

Status: draft. Recipient stanza types are not defined yet; this version fixes the framing, the
payload and the header MAC.

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

## Payload

The payload follows the MAC line's LF: the 16-byte payload nonce, then the chunks.

The plaintext is the content frame: a 4-byte big-endian length `n`, then `n` bytes of UTF-8 JSON
`{"contentType":"<MIME type>"}`, then the content. The real content type is only here, never in the
header or in upload tags. `n` must not exceed 65536.

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
nonce `a0 a1 ... af`. They were produced by `__tests__/reference.ts`, a node:crypto implementation
that shares no code with `src/`. The cases cover a short text, an empty body with two stanzas and a
stanza body that fills a whole line, a plaintext of exactly one chunk, one chunk plus one byte, and
three chunks. `__tests__/envelope.test.ts` lists the failure cases above as tests.
