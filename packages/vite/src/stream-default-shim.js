/**
 * Minimal Node `stream` stub for browser/renderer bundles.
 *
 * Vite externalizes bare `stream` and warns on property access. Deps such as
 * `sax` (pulled in by `rss-parser` via `@seedprotocol/feed` / `@seedprotocol/mapping`)
 * do `require('stream').Stream` inside try/catch at module init — the external
 * stub warns instead of throwing, so the warning still appears.
 *
 * This shim provides a no-op Stream constructor so that path stays quiet without
 * pulling in `stream-browserify` (which breaks Vite SSR / React Router prerender).
 */

function noop() {
  return this
}

export function Stream() {}
Stream.prototype.on = noop
Stream.prototype.once = noop
Stream.prototype.off = noop
Stream.prototype.addListener = noop
Stream.prototype.removeListener = noop
Stream.prototype.removeAllListeners = noop
Stream.prototype.emit = function emit() {
  return false
}
Stream.prototype.pipe = function pipe(dest) {
  return dest
}

export const Readable = Stream
export const Writable = Stream
export const Duplex = Stream
export const Transform = Stream
export const PassThrough = Stream

const api = {
  Stream,
  Readable,
  Writable,
  Duplex,
  Transform,
  PassThrough,
}

export default api
