import { Item } from '@seedprotocol/sdk'

export const ZERO_BYTES32 = '0x' + '0'.repeat(64)
export const BYTES32_LEN = 64

export const waitForItem = async (seedLocalId: string): Promise<InstanceType<typeof Item>> => {
  let item: InstanceType<typeof Item> | undefined

  try {
    item = await Item.find({ seedLocalId } as Parameters<typeof Item.find>[0])
  } catch {
    // No-op: Error is intentionally ignored
  }

  if (item) {
    return item
  }

  return new Promise<InstanceType<typeof Item>>((resolve) => {
    const interval = setInterval(() => {
      try {
        Item.find({ seedLocalId } as Parameters<typeof Item.find>[0])
          .then((found: InstanceType<typeof Item> | undefined) => {
            if (found) {
              clearInterval(interval)
              resolve(found)
            }
          })
      } catch {
        // No-op: Error is intentionally ignored
      }
    }, 200)
  })
}

export function deserializeChunks(
  serialized: unknown
): {
  data_root: Uint8Array
  chunks: Array<{ dataHash: Uint8Array; minByteRange: number; maxByteRange: number }>
  proofs: Array<{ offset: number; proof: Uint8Array }>
} | undefined {
  if (!serialized || typeof serialized !== 'object') return undefined
  const s = serialized as {
    data_root?: number[]
    chunks?: Array<{ dataHash: number[]; minByteRange: number; maxByteRange: number }>
    proofs?: Array<{ offset: number; proof: number[] }>
  }
  if (!Array.isArray(s.data_root)) return undefined
  return {
    data_root: new Uint8Array(s.data_root),
    chunks: (s.chunks ?? []).map((c) => ({ ...c, dataHash: new Uint8Array(c.dataHash ?? []) })),
    proofs: (s.proofs ?? []).map((p) => ({ ...p, proof: new Uint8Array(p.proof ?? []) })),
  }
}

export function serializeChunks(chunks: {
  data_root: Uint8Array
  chunks: Array<{ dataHash: Uint8Array; minByteRange: number; maxByteRange: number }>
  proofs: Array<{ offset: number; proof: Uint8Array }>
}): unknown {
  return {
    data_root: Array.from(chunks.data_root),
    chunks: chunks.chunks.map((c) => ({ ...c, dataHash: Array.from(c.dataHash) })),
    proofs: chunks.proofs.map((p) => ({ ...p, proof: Array.from(p.proof) })),
  }
}
