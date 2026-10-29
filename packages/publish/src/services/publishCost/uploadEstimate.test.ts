import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_CONFIRM_UPLOAD_ABOVE_BYTES,
  DEFAULT_MAX_UPLOAD_BYTES,
  estimateUpload,
} from './uploadEstimate'

const MIB = 2 ** 20
const GIB = 2 ** 30
const work = (sizes: number[]) => ({
  uploadCount: sizes.length,
  uploadBytes: sizes.reduce((a, b) => a + b, 0),
  uploadSizes: sizes,
})

describe('estimateUpload', () => {
  test('defaults: 100 MiB limit, confirm above 25 MiB, 5 Mbit/s', () => {
    expect(DEFAULT_MAX_UPLOAD_BYTES).toBe(100 * MIB)
    expect(DEFAULT_CONFIRM_UPLOAD_ABOVE_BYTES).toBe(25 * MIB)
    const estimate = estimateUpload(work([10 * MIB, 30 * MIB]), { deviceMemoryBytes: undefined })
    expect(estimate).toEqual({
      uploadCount: 2,
      uploadBytes: 40 * MIB,
      largestUploadBytes: 30 * MIB,
      uploadSeconds: Math.ceil((40 * MIB * 8) / 5_000_000),
      uplinkBitsPerSecond: 5_000_000,
      memory: { peakBytes: 280 * MIB, risk: 'unknown' },
      maxUploadBytes: 100 * MIB,
      confirmUploadAboveBytes: 25 * MIB,
      tooLarge: false,
      requiresConfirm: true,
    })
  })

  test('a publish at or under the confirm size goes ahead', () => {
    const estimate = estimateUpload(work([25 * MIB]), { deviceMemoryBytes: 8 * GIB })
    expect(estimate.requiresConfirm).toBe(false)
    expect(estimate.tooLarge).toBe(false)
    expect(estimate.memory.risk).toBe('low')
  })

  test('over the limit is too large', () => {
    expect(estimateUpload(work([60 * MIB, 41 * MIB])).tooLarge).toBe(true)
    expect(estimateUpload(work([101 * MIB]), { maxUploadBytes: Infinity }).tooLarge).toBe(false)
  })

  test('asks for a confirm when the publish would use over a quarter of device memory', () => {
    // 7 × 20 MiB = 140 MiB, over a quarter of 512 MiB
    const estimate = estimateUpload(work([20 * MIB]), { deviceMemoryBytes: 512 * MIB })
    expect(estimate.memory).toEqual({ peakBytes: 140 * MIB, deviceMemoryBytes: 512 * MIB, risk: 'high' })
    expect(estimate.requiresConfirm).toBe(true)
  })

  test('confirmUploadAboveBytes Infinity never asks on size', () => {
    const estimate = estimateUpload(work([90 * MIB]), {
      confirmUploadAboveBytes: Infinity,
      deviceMemoryBytes: undefined,
    })
    expect(estimate.requiresConfirm).toBe(false)
  })

  test('reads navigator.deviceMemory (GiB) when no device memory is given', () => {
    const navigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    Object.defineProperty(globalThis, 'navigator', { value: { deviceMemory: 4 }, configurable: true })
    try {
      expect(estimateUpload(work([MIB])).memory.deviceMemoryBytes).toBe(4 * GIB)
    } finally {
      if (navigator) Object.defineProperty(globalThis, 'navigator', navigator)
      else delete (globalThis as { navigator?: unknown }).navigator
    }
  })

  test('without upload sizes, the largest upload is the total of a single upload', () => {
    expect(estimateUpload({ uploadCount: 1, uploadBytes: 5 }).largestUploadBytes).toBe(5)
    expect(estimateUpload({ uploadCount: 0, uploadBytes: 0 }).largestUploadBytes).toBe(0)
  })
})
