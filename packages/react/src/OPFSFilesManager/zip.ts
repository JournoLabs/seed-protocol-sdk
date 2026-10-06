/**
 * Minimal store-only (uncompressed) ZIP writer. Used so "download selected" produces one
 * file instead of N downloads, which browsers block after the first. Most OPFS content
 * (JPEG, WebP, SQLite pages) doesn't compress well, so skipping deflate costs little.
 * No ZIP64: the archive must stay under 4 GB and 65,535 entries.
 */

let crcTable: Uint32Array | null = null

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable
  crcTable = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crcTable[n] = c >>> 0
  }
  return crcTable
}

export function crc32(data: Uint8Array): number {
  const table = getCrcTable()
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function dosDateTime(timestamp: number): { time: number; date: number } {
  const d = new Date(timestamp)
  const year = Math.max(1980, d.getFullYear())
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

export interface ZipInput {
  /** Path inside the archive, '/'-separated. */
  name: string
  data: Blob
  lastModified?: number
}

const UTF8_FLAG = 0x0800
const MAX_UINT32 = 0xffffffff

export async function createZip(inputs: ZipInput[]): Promise<Blob> {
  if (inputs.length > 0xffff) throw new Error('Too many files for a ZIP archive (max 65,535).')
  const encoder = new TextEncoder()
  const parts: BlobPart[] = []
  const central: Uint8Array<ArrayBuffer>[] = []
  let offset = 0

  for (const input of inputs) {
    const name = encoder.encode(input.name)
    const bytes = new Uint8Array(await input.data.arrayBuffer())
    const crc = crc32(bytes)
    const { time, date } = dosDateTime(input.lastModified ?? Date.now())
    if (offset + bytes.length + 30 + name.length > MAX_UINT32) {
      throw new Error('Selection is too large for a ZIP archive (max 4 GB).')
    }

    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, UTF8_FLAG, true)
    local.setUint16(8, 0, true)
    local.setUint16(10, time, true)
    local.setUint16(12, date, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, bytes.length, true)
    local.setUint32(22, bytes.length, true)
    local.setUint16(26, name.length, true)
    local.setUint16(28, 0, true)
    parts.push(local.buffer, name, bytes)

    const header = new DataView(new ArrayBuffer(46))
    header.setUint32(0, 0x02014b50, true)
    header.setUint16(4, 20, true)
    header.setUint16(6, 20, true)
    header.setUint16(8, UTF8_FLAG, true)
    header.setUint16(10, 0, true)
    header.setUint16(12, time, true)
    header.setUint16(14, date, true)
    header.setUint32(16, crc, true)
    header.setUint32(20, bytes.length, true)
    header.setUint32(24, bytes.length, true)
    header.setUint16(28, name.length, true)
    header.setUint32(42, offset, true)
    const entry = new Uint8Array(46 + name.length)
    entry.set(new Uint8Array(header.buffer), 0)
    entry.set(name, 46)
    central.push(entry)

    offset += 30 + name.length + bytes.length
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, inputs.length, true)
  end.setUint16(10, inputs.length, true)
  end.setUint32(12, centralSize, true)
  end.setUint32(16, offset, true)

  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' })
}
