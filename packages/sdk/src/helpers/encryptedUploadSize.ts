/**
 * Upper bound on the size of a `seed-private/v1` envelope (`@seedprotocol/encryption` SPEC.md)
 * holding `plainBytes`, wrapped to `recipients` `mlkem768x25519` keys, as encryptors built on that
 * package write it: padded with PADMÉ, a bind of up to 256 bytes, a content type of up to 127
 * characters. Cost estimates and upload limits size private uploads with it, before anything is
 * encrypted. Kept beside the SDK rather than imported, because the SDK doesn't depend on the
 * encryption package; a test checks it against real envelopes.
 */
export function estimateEncryptedUploadBytes(plainBytes: number, recipients = 1): number {
  // Content frame: 4-byte length, `{"bodyLength":N,"contentType":"..."}`, the body.
  const frame = 4 + 32 + 16 + 127 + plainBytes
  const padded = padmeLength(frame)
  const chunks = Math.max(1, Math.ceil(padded / 65536))
  const payload = 16 + padded + 16 * chunks
  const versionLine = 16
  const bindLine = 6 + Math.ceil((256 * 4) / 3)
  // `-> mlkem768x25519 <1120 bytes base64>\n` and a 48-byte body on one line plus the empty line.
  const stanza = 18 + Math.ceil((1120 * 4) / 3) + 1 + 64 + 1 + 1
  const macLine = 4 + 43 + 1
  return versionLine + bindLine + recipients * stanza + macLine + payload
}

/** PADMÉ: round `length` up so only the top `floor(log2(E)) + 1` bits of its exponent `E` vary. */
function padmeLength(length: number): number {
  if (length < 2) return length
  const e = Math.floor(Math.log2(length))
  const s = Math.floor(Math.log2(e)) + 1
  const step = 2 ** (e - s)
  return Math.ceil(length / step) * step
}
