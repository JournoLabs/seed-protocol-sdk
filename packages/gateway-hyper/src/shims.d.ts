declare module 'hyperdht' {
  import { EventEmitter } from 'events'
  import type { Duplex } from 'node:stream'

  export interface KeyPair {
    publicKey: Buffer
    secretKey: Buffer
  }

  /** The encrypted stream HyperDHT hands out (a @hyperswarm/secret-stream). */
  export interface HyperDHTStream extends Duplex {
    remotePublicKey: Buffer
    /** The UDX stream underneath; `remoteHost` is the UDP address the connection uses. */
    rawStream: { remoteHost: string | null; remotePort: number | null } | null
  }

  export interface DHTServerOptions {
    /** Return true to refuse the client. Runs after the handshake, before a stream exists. */
    firewall?: (
      remotePublicKey: Buffer,
      remotePayload: unknown,
      clientAddress: { host: string; port: number },
    ) => boolean | Promise<boolean>
  }

  export interface DHTServer extends EventEmitter {
    listen(keyPair: KeyPair): Promise<void>
    close(): Promise<void>
    address(): { port: number; host: string } | null
    on(event: 'connection', listener: (socket: HyperDHTStream) => void): this
  }

  export default class HyperDHT extends EventEmitter {
    constructor(opts?: object)
    static keyPair(seed?: Buffer): KeyPair
    createServer(onconnection?: (socket: HyperDHTStream) => void): DHTServer
    createServer(
      opts: DHTServerOptions,
      onconnection?: (socket: HyperDHTStream) => void,
    ): DHTServer
    connect(remotePublicKey: Buffer, opts?: { keyPair?: KeyPair }): HyperDHTStream
    destroy(): Promise<void>
  }
}

declare module 'hyperdht/testnet' {
  import HyperDHT from 'hyperdht'

  interface Testnet {
    nodes: HyperDHT[]
    bootstrap: { host: string; port: number }[]
    createNode(opts?: object): HyperDHT
    destroy(): Promise<void>
  }

  export default function createTestnet(size?: number, opts?: object): Promise<Testnet>
}

declare module 'hypercore-id-encoding' {
  const ID: {
    encode(key: Buffer | Uint8Array): string
    decode(id: string): Uint8Array
    normalize(key: Buffer | Uint8Array | string): string
  }
  export default ID
}

declare module 'b4a' {
  const b4a: {
    from(input: string | Buffer | Uint8Array, encoding?: string): Buffer
    toString(buf: Buffer | Uint8Array, encoding?: string): string
    isBuffer(value: unknown): value is Buffer
  }
  export default b4a
}
