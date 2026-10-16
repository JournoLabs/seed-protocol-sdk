import { describe, expect, it } from 'vitest'
import {
  COMPOSITE_SEPARATOR,
  decodeCompositeUpload,
  encodeCompositeUpload,
  isCompositeUpload,
} from '@/helpers/compositeUpload'

const BINARY = new Uint8Array(256).map((_, i) => i) // every byte value, incl. NUL and invalid UTF-8
const JPEG_ISH = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xc3, 0x28])
const text = (s: string) => new TextEncoder().encode(s)

describe('composite uploads', () => {
  it('text children keep the legacy format byte for byte', () => {
    const encoded = encodeCompositeUpload([
      { name: 'html', bytes: text('<p>héllo 你好</p>') },
      { name: 'json', bytes: text('{"a":1}') },
    ])
    expect(new TextDecoder().decode(encoded)).toBe(
      `${COMPOSITE_SEPARATOR}html${COMPOSITE_SEPARATOR}<p>héllo 你好</p>${COMPOSITE_SEPARATOR}json${COMPOSITE_SEPARATOR}{"a":1}`,
    )
  })

  it('binary children round-trip exactly', () => {
    const children = [
      { name: 'html', bytes: text('<p>x</p>') },
      { name: 'cover', bytes: BINARY },
      { name: 'thumb', bytes: JPEG_ISH },
      { name: 'empty', bytes: new Uint8Array() },
    ]
    const decoded = decodeCompositeUpload(encodeCompositeUpload(children))
    expect(decoded?.map((c) => c.name)).toEqual(['html', 'cover', 'thumb', 'empty'])
    decoded!.forEach((c, i) => expect(Array.from(c.bytes)).toEqual(Array.from(children[i]!.bytes)))
  })

  it('text that contains the separator is base64-framed so it cannot break the framing', () => {
    const tricky = text(`before ${COMPOSITE_SEPARATOR} after`)
    const decoded = decodeCompositeUpload(encodeCompositeUpload([{ name: 'html', bytes: tricky }]))
    expect(decoded).toHaveLength(1)
    expect(new TextDecoder().decode(decoded![0]!.bytes)).toBe(`before ${COMPOSITE_SEPARATOR} after`)
  })

  it('reads composites written by earlier SDKs', () => {
    const legacy = text(`${COMPOSITE_SEPARATOR}html${COMPOSITE_SEPARATOR}<h1>t</h1>${COMPOSITE_SEPARATOR}json${COMPOSITE_SEPARATOR}{"b":2}`)
    expect(isCompositeUpload(legacy)).toBe(true)
    const decoded = decodeCompositeUpload(legacy)!
    expect(decoded.map((c) => [c.name, new TextDecoder().decode(c.bytes)])).toEqual([
      ['html', '<h1>t</h1>'],
      ['json', '{"b":2}'],
    ])
  })

  it('is not a composite: other content, or a malformed one', () => {
    expect(decodeCompositeUpload(text('<p>plain</p>'))).toBeUndefined()
    expect(decodeCompositeUpload(text(`${COMPOSITE_SEPARATOR}html`))).toBeUndefined()
    expect(decodeCompositeUpload(text(`${COMPOSITE_SEPARATOR}img;base64${COMPOSITE_SEPARATOR}!!!not base64`))).toBeUndefined()
  })
})
