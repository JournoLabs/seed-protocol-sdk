import type { PublishWorkSummary } from './types'

const MIB = 2 ** 20

/**
 * Most a publish uploads by default, summed over its files. A browser publish holds about 7
 * copies of every upload in memory, and the upload API aborts a batch after 120 s, so larger
 * publishes freeze the page or time out on ordinary uplinks.
 */
export const DEFAULT_MAX_UPLOAD_BYTES = 100 * MIB
/** Above this many upload bytes a publish waits for the app's `confirmUpload: true`. */
export const DEFAULT_CONFIRM_UPLOAD_ABOVE_BYTES = 25 * MIB
/** Uplink assumed for `uploadSeconds` when the app sets none: 5 Mbit/s. */
export const DEFAULT_UPLINK_BITS_PER_SECOND = 5_000_000
/**
 * Peak memory of a browser publish as a multiple of its upload bytes, measured on Chromium
 * (2026-10-29): the file read holds 6 copies on top of the copy the OPFS mount keeps.
 */
export const PUBLISH_MEMORY_MULTIPLIER = 7

export type UploadLimits = {
  /** Default {@link DEFAULT_MAX_UPLOAD_BYTES}. `Infinity` turns the limit off. */
  maxUploadBytes?: number
  /** Default {@link DEFAULT_CONFIRM_UPLOAD_ABOVE_BYTES}. `Infinity` never asks. */
  confirmUploadAboveBytes?: number
  /** Default {@link DEFAULT_UPLINK_BITS_PER_SECOND}. */
  uplinkBitsPerSecond?: number
}

export type UploadEstimate = {
  uploadCount: number
  uploadBytes: number
  largestUploadBytes: number
  /** Seconds to send `uploadBytes` at `uplinkBitsPerSecond`. */
  uploadSeconds: number
  uplinkBitsPerSecond: number
  memory: {
    /** Peak memory of the publish in a browser: {@link PUBLISH_MEMORY_MULTIPLIER} × `uploadBytes`. */
    peakBytes: number
    /**
     * `navigator.deviceMemory` in bytes. Chromium only, rounded to a power of two and capped by
     * the browser, so treat it as coarse; undefined in Safari, Firefox and Node.
     */
    deviceMemoryBytes?: number
    /** `high` when `peakBytes` is over a quarter of `deviceMemoryBytes`; `unknown` without it. */
    risk: 'low' | 'high' | 'unknown'
  }
  maxUploadBytes: number
  confirmUploadAboveBytes: number
  /** `uploadBytes` is over `maxUploadBytes`: publish fails with UploadTooLargeError. */
  tooLarge: boolean
  /**
   * `uploadBytes` is over `confirmUploadAboveBytes`, or `memory.risk` is `high`: publish fails
   * with UploadNeedsConfirmError unless it is given `confirmUpload: true`.
   */
  requiresConfirm: boolean
}

function deviceMemoryBytes(): number | undefined {
  const gib = (globalThis.navigator as { deviceMemory?: unknown } | undefined)?.deviceMemory
  return typeof gib === 'number' && gib > 0 ? gib * 2 ** 30 : undefined
}

/** Size, time and memory of a publish's uploads, and whether the limits stop or hold it. */
export function estimateUpload(
  work: Pick<PublishWorkSummary, 'uploadCount' | 'uploadBytes' | 'uploadSizes'>,
  limits?: UploadLimits & { deviceMemoryBytes?: number },
): UploadEstimate {
  const maxUploadBytes = limits?.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES
  const confirmUploadAboveBytes = limits?.confirmUploadAboveBytes ?? DEFAULT_CONFIRM_UPLOAD_ABOVE_BYTES
  const uplinkBitsPerSecond = limits?.uplinkBitsPerSecond ?? DEFAULT_UPLINK_BITS_PER_SECOND
  const sizes = work.uploadSizes ?? []
  const largestUploadBytes = sizes.length > 0 ? Math.max(...sizes) : work.uploadCount > 0 ? work.uploadBytes : 0
  const peakBytes = PUBLISH_MEMORY_MULTIPLIER * work.uploadBytes
  const memoryBytes = limits && 'deviceMemoryBytes' in limits ? limits.deviceMemoryBytes : deviceMemoryBytes()
  const risk = memoryBytes == null ? 'unknown' : peakBytes > memoryBytes / 4 ? 'high' : 'low'
  return {
    uploadCount: work.uploadCount,
    uploadBytes: work.uploadBytes,
    largestUploadBytes,
    uploadSeconds: Math.ceil((work.uploadBytes * 8) / uplinkBitsPerSecond),
    uplinkBitsPerSecond,
    memory: { peakBytes, ...(memoryBytes != null && { deviceMemoryBytes: memoryBytes }), risk },
    maxUploadBytes,
    confirmUploadAboveBytes,
    tooLarge: work.uploadBytes > maxUploadBytes,
    requiresConfirm: work.uploadBytes > confirmUploadAboveBytes || risk === 'high',
  }
}
