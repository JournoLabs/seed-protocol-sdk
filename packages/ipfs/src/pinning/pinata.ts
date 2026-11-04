import type { Fetch, PinningProvider } from './types'

export type PinataOptions = {
  /** A Pinata API JWT with upload rights. */
  jwt: string
  /** Pinata group to add uploads to. */
  groupId?: string
  /** Defaults to `https://uploads.pinata.cloud/v3/files`. */
  uploadUrl?: string
  fetch?: Fetch
}

/**
 * Pinata's v3 upload API with `car=true` on the public network. Pinata imports a CAR in the
 * background and accepts CARs only on paid plans. It has no `isPinned`, so the store checks a
 * gateway before attesting.
 */
export function pinataPinning(options: PinataOptions): PinningProvider {
  const uploadUrl = options.uploadUrl ?? 'https://uploads.pinata.cloud/v3/files'
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init))

  return {
    id: 'pinata',
    async pinCar(car, root) {
      const form = new FormData()
      form.append('file', new Blob([car as Uint8Array<ArrayBuffer>], { type: 'application/vnd.ipld.car' }), `${root}.car`)
      form.append('network', 'public')
      form.append('car', 'true')
      form.append('name', root)
      if (options.groupId) form.append('group_id', options.groupId)
      const response = await doFetch(uploadUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${options.jwt}` },
        body: form,
      })
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(`Pinata upload failed: ${response.status} ${text.slice(0, 200)}`)
      }
      const body = (await response.json().catch(() => ({}))) as { data?: { cid?: string } }
      const cid = body.data?.cid
      if (cid && cid !== root) throw new Error(`Pinata stored ${cid}, expected ${root}`)
    },
  }
}
