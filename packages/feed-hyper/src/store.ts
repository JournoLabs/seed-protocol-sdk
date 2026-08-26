import Corestore from 'corestore'
import Hyperdrive from 'hyperdrive'
import Hyperswarm from 'hyperswarm'
import ID from 'hypercore-id-encoding'

export type FeedStoreHandles = {
  store: Corestore
  drive: Hyperdrive
  swarm: Hyperswarm | null
}

export type OpenStoreOptions = {
  storePath: string
  /** Named core for a writable publisher drive (default: seed-feed). Ignored when `key` is set. */
  driveName?: string
  /** z32 or hex public key for a readonly / seeder drive */
  key?: string
  /** Join Hyperswarm and announce/lookup the drive discovery key (default: true) */
  announce?: boolean
}

function decodeKey(key: string): Buffer {
  return Buffer.from(ID.decode(key))
}

export function encodeKey(key: Buffer | Uint8Array): string {
  return ID.normalize(key)
}

/**
 * Open a Corestore + Hyperdrive. With `key`, opens that drive (replicate).
 * Without `key`, opens/creates a named writable drive.
 */
export async function openFeedStore(options: OpenStoreOptions): Promise<FeedStoreHandles> {
  const store = new Corestore(options.storePath)
  await store.ready()

  const drive = options.key
    ? new Hyperdrive(store, decodeKey(options.key))
    : new Hyperdrive(store, { name: options.driveName ?? 'seed-feed' })

  await drive.ready()

  let swarm: Hyperswarm | null = null
  if (options.announce !== false) {
    swarm = new Hyperswarm()
    swarm.on('connection', (conn: unknown) => {
      store.replicate(conn as Parameters<Corestore['replicate']>[0])
    })
    swarm.join(drive.discoveryKey, { server: true, client: true })
    await swarm.flush()
  }

  return { store, drive, swarm }
}

export async function closeFeedStore(handles: FeedStoreHandles): Promise<void> {
  if (handles.swarm) {
    await handles.swarm.destroy()
  }
  await handles.drive.close()
  await handles.store.close()
}

/** In-process duplex replicate between two corestores (for tests / tooling). */
export function replicateStores(a: Corestore, b: Corestore): () => void {
  const s1 = a.replicate(true) as NodeJS.ReadWriteStream & { destroy?: () => void }
  const s2 = b.replicate(false) as NodeJS.ReadWriteStream & { destroy?: () => void }
  s1.pipe(s2).pipe(s1)
  return () => {
    s1.destroy?.()
    s2.destroy?.()
  }
}

export function keyToBuffer(key: string | Buffer | Uint8Array): Buffer {
  if (typeof key === 'string') return decodeKey(key)
  return Buffer.from(key)
}

export { ID }
