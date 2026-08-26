declare module 'corestore' {
  import { EventEmitter } from 'events'

  export default class Corestore extends EventEmitter {
    constructor(storage: string | unknown, options?: object)
    ready(): Promise<void>
    close(): Promise<void>
    get(keyOrOpts: Buffer | Uint8Array | string | { name?: string; key?: Buffer }): unknown
    replicate(isInitiator?: boolean | unknown): NodeJS.ReadWriteStream
    namespace(name: string): Corestore
  }
}

declare module 'hyperdrive' {
  import { EventEmitter } from 'events'

  export default class Hyperdrive extends EventEmitter {
    constructor(store: unknown, keyOrOpts?: Buffer | Uint8Array | string | { name?: string })
    ready(): Promise<void>
    close(): Promise<void>
    get(path: string): Promise<Uint8Array | null>
    put(path: string, buf: Uint8Array | Buffer): Promise<void>
    readonly key: Buffer
    readonly discoveryKey: Buffer
    readonly version: number
    readonly core: {
      length: number
      update(opts?: { wait?: boolean }): Promise<void>
      on(event: string, listener: (...args: unknown[]) => void): void
      off(event: string, listener: (...args: unknown[]) => void): void
    }
  }
}

declare module 'hyperswarm' {
  import { EventEmitter } from 'events'

  export default class Hyperswarm extends EventEmitter {
    join(
      topic: Buffer | Uint8Array,
      opts?: { server?: boolean; client?: boolean },
    ): { flushed(): Promise<void> }
    flush(): Promise<void>
    destroy(): Promise<void>
    on(event: 'connection', listener: (conn: unknown) => void): this
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

declare module 'serve-drive' {
  export default class ServeDrive {
    constructor(opts: {
      get: (args: {
        key: Buffer | null
        filename: string
        version: number
      }) => unknown | Promise<unknown>
      port?: number
      host?: string
      anyPort?: boolean
      server?: unknown
      token?: false | string | Buffer
    })
    ready(): Promise<void>
    close?(): Promise<void>
    suspend?(): Promise<void>
    address(): { port: number; address?: string } | null
    getLink?(
      path: string,
      opts?: { https?: boolean; host?: string; key?: string; version?: number },
    ): string
  }
}
