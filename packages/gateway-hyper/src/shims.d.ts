declare module 'hyperdht' {
  import { EventEmitter } from 'events'

  export interface KeyPair {
    publicKey: Buffer
    secretKey: Buffer
  }

  export interface DHTServer extends EventEmitter {
    listen(keyPair: KeyPair): Promise<void>
    close(): Promise<void>
    address(): { port: number; host: string } | null
    on(event: 'connection', listener: (socket: NodeJS.ReadWriteStream) => void): this
  }

  export default class HyperDHT extends EventEmitter {
    constructor(opts?: object)
    static keyPair(seed?: Buffer): KeyPair
    createServer(onconnection?: (socket: NodeJS.ReadWriteStream) => void): DHTServer
    connect(remotePublicKey: Buffer, opts?: { keyPair?: KeyPair }): NodeJS.ReadWriteStream
    destroy(): Promise<void>
  }
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
