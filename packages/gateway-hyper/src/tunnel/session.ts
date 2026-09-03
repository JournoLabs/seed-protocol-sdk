import type { Duplex } from 'node:stream'
import HyperDHT from 'hyperdht'
import { createEphemeralClientKeypair, decodePublicKey } from '../keys'
import type { TunnelMeta, TunnelResponseMeta } from '../types'
import { readTunnelResponse, writeTunnelRequest } from './protocol'

export type TunnelSessionOptions = {
  /** Operator public key (z32 or hex) */
  key: string
  /** Optional store path for DHT client state */
  storePath?: string
}

export type TunnelSession = {
  key: string
  runOnTunnel: <T>(fn: (socket: Duplex) => Promise<T>) => Promise<T>
  forwardHttp: (
    meta: TunnelMeta,
    body: Buffer,
  ) => Promise<{ meta: TunnelResponseMeta; body: Buffer }>
  close: () => Promise<void>
}

/**
 * Dial the operator HyperDHT key and expose a serialized request/response forwarder.
 */
export async function createTunnelSession(options: TunnelSessionOptions): Promise<TunnelSession> {
  const remotePublicKey = decodePublicKey(options.key)
  const clientKey = createEphemeralClientKeypair()

  const dht = new HyperDHT()
  let activeSocket: Duplex | null = null
  let connecting: Promise<Duplex> | null = null

  const getSocket = async (): Promise<Duplex> => {
    if (activeSocket && !activeSocket.destroyed) {
      return activeSocket
    }
    if (connecting) {
      return connecting
    }
    connecting = new Promise<Duplex>((resolve, reject) => {
      const socket = dht.connect(remotePublicKey, {
        keyPair: { publicKey: clientKey.publicKey, secretKey: clientKey.secretKey },
      }) as Duplex
      const onReady = () => {
        activeSocket = socket
        connecting = null
        resolve(socket)
      }
      socket.once('open', onReady)
      socket.once('connect', onReady)
      socket.once('error', (err: Error) => {
        connecting = null
        reject(err)
      })
    })
    return connecting
  }

  /** Serialize tunnel transactions on one persistent socket. */
  let tunnelQueue: Promise<unknown> = Promise.resolve()
  const runOnTunnel = async <T>(fn: (socket: Duplex) => Promise<T>): Promise<T> => {
    const run = tunnelQueue.then(() => getSocket()).then(fn)
    tunnelQueue = run.catch(() => {})
    return run
  }

  const forwardHttp = async (
    meta: TunnelMeta,
    body: Buffer,
  ): Promise<{ meta: TunnelResponseMeta; body: Buffer }> => {
    return runOnTunnel(async (socket) => {
      await writeTunnelRequest(socket, meta, body)
      return readTunnelResponse(socket)
    })
  }

  return {
    key: options.key,
    runOnTunnel,
    forwardHttp,
    close: async () => {
      if (activeSocket && !activeSocket.destroyed) {
        activeSocket.destroy()
      }
      await dht.destroy()
    },
  }
}
