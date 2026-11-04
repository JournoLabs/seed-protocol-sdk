import type { Fetch, PinningProvider } from './types'

export type KuboRpcOptions = {
  /** The node's RPC API, e.g. `http://127.0.0.1:5001`. */
  url: string
  /** Sent with every request, e.g. `{ Authorization: 'Bearer …' }` for a hosted Kubo RPC. */
  headers?: Record<string, string>
  fetch?: Fetch
}

const carBlob = (car: Uint8Array) => new Blob([car as Uint8Array<ArrayBuffer>], { type: 'application/vnd.ipld.car' })

/**
 * A Kubo node's RPC API: your own node, or a host that offers it. Uploads with
 * `/api/v0/dag/import?pin-roots=true` and checks pins with `/api/v0/pin/ls`.
 */
export function kuboRpcPinning(options: KuboRpcOptions): PinningProvider {
  const base = options.url.replace(/\/$/, '')
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init))
  const post = (path: string, body?: FormData) =>
    doFetch(`${base}/api/v0/${path}`, { method: 'POST', headers: options.headers, body })

  return {
    id: 'kubo',
    async pinCar(car, root) {
      const form = new FormData()
      form.append('file', carBlob(car), `${root}.car`)
      const response = await post('dag/import?pin-roots=true', form)
      const text = await response.text()
      if (!response.ok) throw new Error(`Kubo dag/import failed: ${response.status} ${text.slice(0, 200)}`)
      // One JSON object per line; the Root line reports the pin.
      for (const line of text.split('\n')) {
        if (!line.trim()) continue
        const parsed = JSON.parse(line) as { Root?: { Cid?: { '/': string }; PinErrorMsg?: string } }
        if (!parsed.Root) continue
        if (parsed.Root.PinErrorMsg) throw new Error(`Kubo could not pin ${root}: ${parsed.Root.PinErrorMsg}`)
        if (parsed.Root.Cid?.['/'] === root) return
      }
      throw new Error(`Kubo dag/import did not report ${root} as a pinned root`)
    },
    async isPinned(root) {
      const response = await post(`pin/ls?arg=${encodeURIComponent(root)}&type=recursive`)
      const text = await response.text()
      if (response.ok) return text.includes(root)
      // Kubo answers 500 with "… is not pinned" for an unpinned CID.
      if (/not pinned/i.test(text)) return false
      throw new Error(`Kubo pin/ls failed: ${response.status} ${text.slice(0, 200)}`)
    },
  }
}
