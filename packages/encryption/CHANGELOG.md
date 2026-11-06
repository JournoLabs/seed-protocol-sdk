# Changelog

All notable changes to this package are documented in this file.

## Unreleased

- New package, not published yet. `encryptEnvelope` and `decryptEnvelope` implement the `seed-private/v1` envelope described in `SPEC.md`: a header of recipient stanzas and a `bind` line, authenticated by an HMAC under the file key, and a payload of 64 KiB AES-256-GCM chunks whose first bytes hold the content type and body length. The plaintext is zero-padded to its PADMÉ length by default (at most 12% extra), so the envelope size shows a size class rather than the exact length; `padding: 'none'` turns that off. Decryption fails with an `EnvelopeError` whose `code` names the problem (`HEADER_MAC`, `TRUNCATED`, `BAD_CHUNK`, `TRAILING_DATA`, `BIND_MISMATCH`, ...).
- `registerEntitlementAdapter(kind, adapter)` and `isEntitled(policy, address, blockTag)`: one adapter per access-policy kind decides who may receive keys.
