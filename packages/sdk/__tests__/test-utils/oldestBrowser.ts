/**
 * Makes the test page look like the oldest browsers the SDK supports by deleting JavaScript builtins
 * they lack. Imported first by the browser setup files, before any SDK or dependency module loads,
 * so a call to a newer builtin fails the tests that reach it instead of failing for users on older
 * browsers. @zenfs/core 2.5.6 called Iterator helpers (Chrome 122, Firefox 131, Safari 18.4) when
 * it loaded, and the SDK didn't initialise in browsers older than those.
 *
 * Covers the page only: SQLocal's worker and the SDK's own workers keep every builtin. Web APIs
 * aren't removed, so SUPPORT_FLOOR has to be at or above what the SDK's Web APIs need.
 */

/**
 * Oldest supported browsers (docs/GETTING_STARTED.md, "Supported browsers"), set by the Web APIs
 * every client uses (per @mdn/browser-compat-data): OPFS sync access handles for the database
 * (Chrome 102), module workers for SQLocal (Firefox 114) and FileSystemFileHandle.createWritable
 * for every OPFS file write (Safari 26).
 */
export const SUPPORT_FLOOR = { chrome: 102, firefox: 114, safari: 26 } as const

/**
 * Builtins added in Chrome 110, Firefox 115, Safari 16.4 or later, with the version each browser
 * added them in (null: not shipped). From @mdn/browser-compat-data 8.1.7, `javascript.builtins`;
 * nothing deletable was added between SUPPORT_FLOOR and those versions. Lowering the floor further
 * needs older rows.
 * `X.name` is a static or prototype property of X; `TypedArray` is %TypedArray%.
 */
const BUILTINS: [path: string, chrome: number | null, firefox: number | null, safari: number | null][] = [
  ['Array.fromAsync', 121, 115, 16.4],
  ['Array.toReversed', 110, 115, 16],
  ['Array.toSorted', 110, 115, 16],
  ['Array.toSpliced', 110, 115, 16],
  ['Array.with', 110, 115, 16],
  ['ArrayBuffer.detached', 114, 122, 17.4],
  ['ArrayBuffer.maxByteLength', 111, 128, 16.4],
  ['ArrayBuffer.resizable', 111, 128, 16.4],
  ['ArrayBuffer.resize', 111, 128, 16.4],
  ['ArrayBuffer.transfer', 114, 122, 17.4],
  ['ArrayBuffer.transferToFixedLength', 114, 122, 17.4],
  ['AsyncDisposableStack', 134, 141, null],
  ['AsyncDisposableStack.adopt', 134, 141, null],
  ['AsyncDisposableStack.defer', 134, 141, null],
  ['AsyncDisposableStack.disposeAsync', 134, 141, null],
  ['AsyncDisposableStack.disposed', 134, 141, null],
  ['AsyncDisposableStack.move', 134, 141, null],
  ['AsyncDisposableStack.use', 134, 141, null],
  ['Atomics.pause', 133, 137, 18.4],
  ['Atomics.waitAsync', 90, 145, 16.4],
  ['DataView.getFloat16', 135, 129, 18.2],
  ['DataView.setFloat16', 135, 129, 18.2],
  ['Date.toTemporalInstant', 144, 139, null],
  ['DisposableStack', 134, 141, null],
  ['DisposableStack.adopt', 134, 141, null],
  ['DisposableStack.defer', 134, 141, null],
  ['DisposableStack.dispose', 134, 141, null],
  ['DisposableStack.disposed', 134, 141, null],
  ['DisposableStack.move', 134, 141, null],
  ['DisposableStack.use', 134, 141, null],
  ['Error.isError', 134, 138, null],
  ['Float16Array', 135, 129, 18.2],
  ['Iterator', 122, 131, 18.4],
  ['Iterator.concat', 146, 147, 26.4],
  ['Iterator.drop', 122, 131, 18.4],
  ['Iterator.every', 122, 131, 18.4],
  ['Iterator.filter', 122, 131, 18.4],
  ['Iterator.find', 122, 131, 18.4],
  ['Iterator.flatMap', 122, 131, 18.4],
  ['Iterator.forEach', 122, 131, 18.4],
  ['Iterator.from', 122, 131, 18.4],
  ['Iterator.includes', 154, 154, null],
  ['Iterator.join', 153, 154, null],
  ['Iterator.map', 122, 131, 18.4],
  ['Iterator.reduce', 122, 131, 18.4],
  ['Iterator.some', 122, 131, 18.4],
  ['Iterator.take', 122, 131, 18.4],
  ['Iterator.toArray', 122, 131, 18.4],
  ['Iterator.zip', 153, 148, null],
  ['Iterator.zipKeyed', 153, 148, null],
  ['JSON.isRawJSON', 114, 135, 18.4],
  ['JSON.rawJSON', 114, 135, 18.4],
  ['Map.getOrInsert', 145, 144, 26.2],
  ['Map.getOrInsertComputed', 145, 144, 26.2],
  ['Map.groupBy', 117, 119, 17.4],
  ['Math.f16round', 135, 129, 18.2],
  ['Math.sumPrecise', 147, 137, 26.2],
  ['Object.groupBy', 117, 119, 17.4],
  ['Promise.try', 128, 134, 18.2],
  ['Promise.withResolvers', 119, 121, 17.4],
  ['RegExp.escape', 136, 134, 18.2],
  ['Set.difference', 122, 127, 17],
  ['Set.intersection', 122, 127, 17],
  ['Set.isDisjointFrom', 122, 127, 17],
  ['Set.isSubsetOf', 122, 127, 17],
  ['Set.isSupersetOf', 122, 127, 17],
  ['Set.symmetricDifference', 122, 127, 17],
  ['Set.union', 122, 127, 17],
  ['SharedArrayBuffer.grow', 111, 128, 16.4],
  ['SharedArrayBuffer.growable', 111, 128, 16.4],
  ['SharedArrayBuffer.maxByteLength', 111, 128, 16.4],
  ['String.isWellFormed', 111, 119, 16.4],
  ['String.toWellFormed', 111, 119, 16.4],
  ['SuppressedError', 134, 141, null],
  ['SuppressedError.error', 134, 141, null],
  ['SuppressedError.suppressed', 134, 141, null],
  ['Symbol.asyncDispose', 127, 141, null],
  ['Symbol.dispose', 125, 141, null],
  ['TypedArray.toReversed', 110, 115, 16],
  ['TypedArray.toSorted', 110, 115, 16],
  ['TypedArray.with', 110, 115, 16],
  ['Uint8Array.fromBase64', 140, 133, 18.2],
  ['Uint8Array.fromHex', 140, 133, 18.2],
  ['Uint8Array.setFromBase64', 140, 133, 18.2],
  ['Uint8Array.setFromHex', 140, 133, 18.2],
  ['Uint8Array.toBase64', 140, 133, 18.2],
  ['Uint8Array.toHex', 140, 133, 18.2],
  ['WeakMap.getOrInsert', 145, 144, 26.2],
  ['WeakMap.getOrInsertComputed', 145, 144, 26.2],
]

const isNewerThanFloor = ([, chrome, firefox, safari]: (typeof BUILTINS)[number]) =>
  chrome === null || chrome > SUPPORT_FLOOR.chrome ||
  firefox === null || firefox > SUPPORT_FLOOR.firefox ||
  safari === null || safari > SUPPORT_FLOOR.safari

const ownerOf = (name: string): any =>
  name === 'TypedArray' ? Object.getPrototypeOf(Int8Array) : (globalThis as any)[name]

/** Builtins deleted from this page. Well-known symbols such as Symbol.dispose can't be deleted. */
export const removedBuiltins: string[] = []

const removeProperty = (owner: object, key: string, path: string) => {
  if (Reflect.deleteProperty(owner, key) && !Object.hasOwn(owner, key)) removedBuiltins.push(path)
}

const newer = BUILTINS.filter(isNewerThanFloor).map(([path]) => path)
// Members before globals: Iterator.prototype (%IteratorPrototype%) is reached through the global.
for (const path of newer.filter((path) => path.includes('.'))) {
  const [ownerName, key] = path.split('.')
  const owner = ownerOf(ownerName)
  if (owner && Object.hasOwn(owner, key)) removeProperty(owner, key, path)
  else if (owner?.prototype && Object.hasOwn(owner.prototype, key)) removeProperty(owner.prototype, key, path)
}
for (const path of newer.filter((path) => !path.includes('.'))) {
  if (Object.hasOwn(globalThis, path)) removeProperty(globalThis, path, path)
}
