/** A service that keeps blocks on IPFS. Each upload is a CARv1 with one root. */
export interface PinningProvider {
  /** Names the provider in errors: `kubo`, `pinata`, ... */
  readonly id: string
  /** Uploads `car` and pins `root`. Throws unless the provider accepted it. */
  pinCar(car: Uint8Array, root: string): Promise<void>
  /**
   * Whether the provider holds `root` pinned. Leave it out when the provider can't say (Pinata
   * imports CARs in the background); the store then asks a gateway instead.
   */
  isPinned?(root: string): Promise<boolean>
}

/** A `fetch`, so tests and apps can route requests. Defaults to the global one. */
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>
