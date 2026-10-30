import { assertBagPath, type Bag } from './bag'
import { utf8 } from './bytes'
import { ArchiveError } from './errors'

/**
 * A bag on Arweave: each file is its own transaction, and an `arweave/paths` manifest lays them out
 * at their bag paths, so a gateway serves the bag under one id.
 * https://github.com/ArweaveTeam/arweave/blob/master/doc/path-manifest-schema.md
 */

export const PATH_MANIFEST_CONTENT_TYPE = 'application/x.arweave-manifest+json'

const PATH_MANIFEST_TYPE = 'arweave/paths'
const PATH_MANIFEST_VERSION = '0.2.0'
const INDEX_PATH = 'data/index.html'
const PAYLOAD_ASSETS = 'data/assets/'
const ARWEAVE_TX_ID = /^[a-zA-Z0-9_-]{43}$/

export type PathManifest = {
  manifest: typeof PATH_MANIFEST_TYPE
  version: typeof PATH_MANIFEST_VERSION
  index?: { path: string }
  paths: Record<string, { id: string }>
}

const assertTransactionId = (path: string, id: unknown): void => {
  if (typeof id !== 'string' || !ARWEAVE_TX_ID.test(id)) {
    throw new ArchiveError('invalid_manifest', `${path} names ${JSON.stringify(id)}, which is not an Arweave transaction id`)
  }
}

/**
 * The manifest for `bag`, given the transaction of each file by bag path. `data/index.html` is its
 * index when the bag has one. A gateway serves the index at the manifest's root, where that page's
 * relative `assets/…` links resolve to `assets/…`, so each asset is listed there too.
 * `bytes` are what to upload, with {@link PATH_MANIFEST_CONTENT_TYPE}; they depend only on the input.
 */
export function buildPathManifest(
  bag: Bag,
  transactions: Readonly<Record<string, string>>,
): { manifest: PathManifest; bytes: Uint8Array } {
  const bagPaths = new Set(bag.files.map((file) => file.path))
  const unknown = Object.keys(transactions).filter((path) => !bagPaths.has(path))
  if (unknown.length > 0) throw new ArchiveError('invalid_manifest', `Not in the bag: ${unknown.join(', ')}`)

  const paths: Record<string, { id: string }> = {}
  for (const path of [...bagPaths].sort()) {
    const id = transactions[path]
    if (id === undefined) throw new ArchiveError('invalid_manifest', `${path} has no transaction`)
    assertTransactionId(path, id)
    paths[path] = { id }
  }
  const hasIndex = bagPaths.has(INDEX_PATH)
  if (hasIndex) {
    for (const path of [...bagPaths].sort()) {
      if (path.startsWith(PAYLOAD_ASSETS)) paths[path.slice('data/'.length)] = { id: transactions[path]! }
    }
  }
  const manifest: PathManifest = {
    manifest: PATH_MANIFEST_TYPE,
    version: PATH_MANIFEST_VERSION,
    ...(hasIndex ? { index: { path: INDEX_PATH } } : {}),
    paths,
  }
  return { manifest, bytes: utf8(JSON.stringify(manifest)) }
}

/** Reads a manifest. It comes from Arweave, so every path and id is checked before use. */
export function parsePathManifest(data: Uint8Array | string): PathManifest {
  const text = typeof data === 'string' ? data : new TextDecoder().decode(data)
  let parsed: Partial<PathManifest> | null
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new ArchiveError('invalid_manifest', 'The manifest is not JSON')
  }
  if (parsed?.manifest !== PATH_MANIFEST_TYPE || parsed.version !== PATH_MANIFEST_VERSION) {
    throw new ArchiveError('invalid_manifest', `Expected ${PATH_MANIFEST_TYPE} ${PATH_MANIFEST_VERSION}`)
  }
  const { paths, index } = parsed
  if (!paths || typeof paths !== 'object') throw new ArchiveError('invalid_manifest', 'The manifest has no paths')
  for (const [path, entry] of Object.entries(paths)) {
    assertBagPath(path)
    assertTransactionId(path, entry?.id)
  }
  if (index && !paths[index.path]) throw new ArchiveError('invalid_manifest', `The index ${index.path} is not in paths`)
  return parsed as PathManifest
}

/**
 * Fetches every path of `manifest` and returns the bag, without the asset paths that exist for the
 * index. Check it with `verifyArchive`: nothing here says the bytes are the ones anchored.
 * `fetchTransaction` resolves to the transaction's bytes, or undefined when it can't be read, which
 * throws `missing_file`.
 */
export async function readBagFromManifest(
  manifest: PathManifest,
  fetchTransaction: (id: string) => Promise<Uint8Array | undefined>,
): Promise<Bag> {
  const entries = Object.entries(manifest.paths).filter(([path]) => !path.startsWith('assets/'))
  const files = await Promise.all(
    entries.map(async ([path, { id }]) => {
      const bytes = await fetchTransaction(id)
      if (!bytes) throw new ArchiveError('missing_file', `Couldn't read ${path} from transaction ${id}`)
      return { path, bytes }
    }),
  )
  return { files }
}
