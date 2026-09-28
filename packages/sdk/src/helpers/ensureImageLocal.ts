import debug from 'debug'
import { downloadTransactionIdWithDedupe } from '@/events/files/download'
import { ImageSize } from '@/helpers/constants'
import { supportsOpfsFileDownloads } from '@/helpers/environment'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'

const logger = debug('seedSdk:helpers:ensureImageLocal')

/** Arweave transaction ids are 43 chars in the URL-safe base64 alphabet. */
const ARWEAVE_TX_ID_RE = /^[a-z0-9_-]{43}$/i

const IMAGE_SIZES = [
  ImageSize.EXTRA_SMALL,
  ImageSize.SMALL,
  ImageSize.MEDIUM,
  ImageSize.LARGE,
  ImageSize.EXTRA_LARGE,
] as const

export type EnsureImageLocalParams = {
  /** 43-char tx id, or a URL/path containing one */
  transactionId?: string
  /** Local basename / refResolvedValue under images/ */
  fileName?: string
  /** Display widths; each mapped to closest ImageSize. Default: [EXTRA_SMALL] */
  widths?: number[]
}

export type EnsureImageLocalResult = {
  status: 'ready' | 'unsupported' | 'failed' | 'missing-id'
  filePath?: string
  createdWidths?: number[]
}

const inFlightByKey = new Map<string, Promise<EnsureImageLocalResult>>()

export const normalizeArweaveTxIdForEnsure = (
  raw: string | null | undefined,
): string | undefined => {
  if (raw == null || raw === '') return undefined
  const t = String(raw).trim()
  if (ARWEAVE_TX_ID_RE.test(t)) return t
  const m = t.match(/^([a-z0-9_-]{43})(?:\.[^/]+)?$/i)
  if (m) return m[1]
  const embedded = t.match(/[a-z0-9_-]{43}/gi)
  if (embedded) {
    for (const candidate of embedded) {
      if (ARWEAVE_TX_ID_RE.test(candidate)) return candidate
    }
  }
  return undefined
}

export const closestImageSize = (width: number): ImageSize => {
  let best: ImageSize = ImageSize.EXTRA_SMALL
  let bestDist = Math.abs(best - width)
  for (const size of IMAGE_SIZES) {
    const dist = Math.abs(size - width)
    if (dist < bestDist) {
      best = size
      bestDist = dist
    }
  }
  return best
}

const mapRequestedWidthsToImageSizes = (widths?: number[]): ImageSize[] => {
  const requested =
    widths && widths.length > 0 ? widths : [ImageSize.EXTRA_SMALL]
  const unique = new Set<ImageSize>()
  for (const w of requested) {
    if (typeof w !== 'number' || !Number.isFinite(w) || w <= 0) continue
    unique.add(closestImageSize(w))
  }
  if (unique.size === 0) {
    unique.add(ImageSize.EXTRA_SMALL)
  }
  return Array.from(unique).sort((a, b) => a - b)
}

const getBasename = (filePath: string): string => {
  const path = BaseFileManager.getPathModule()
  return path.basename(filePath)
}

const getBasenameWithoutExtension = (fileName: string): string => {
  const match = fileName.match(/^(.*[\/\\])?([^\/\\]+?)(\.[^.\/\\]*)?$/)
  return match?.[2] ?? fileName
}

const resolveMatchingImagePath = async (
  needle: string,
): Promise<string | undefined> => {
  const dirPath = BaseFileManager.getFilesPath('images')
  const dirExists = await BaseFileManager.pathExists(dirPath)
  if (!dirExists) return undefined

  const fs = await BaseFileManager.getFs()
  const path = BaseFileManager.getPathModule()
  const files: string[] = await fs.promises.readdir(dirPath)

  // Prefer exact basename match (files only); skip size dirs.
  const exact = files.find((file: string) => path.basename(file) === needle)
  if (exact) {
    const candidate = BaseFileManager.getFilesPath('images', exact)
    try {
      const zenfs = await BaseFileManager.getFs()
      const stat = await zenfs.promises.stat(candidate)
      if (stat.isFile()) return candidate
    } catch {
      // fall through
    }
  }

  const matchingFiles = files.filter((file: string) => {
    const base = path.basename(file)
    return base.includes(needle)
  })
  for (const file of matchingFiles) {
    const candidate = BaseFileManager.getFilesPath('images', file)
    try {
      const zenfs = await BaseFileManager.getFs()
      const stat = await zenfs.promises.stat(candidate)
      if (stat.isFile()) return candidate
    } catch {
      continue
    }
  }
  return undefined
}

const sizedVariantPath = (originalFilePath: string, size: ImageSize): string => {
  const path = BaseFileManager.getPathModule()
  const dir = path.dirname(originalFilePath)
  const base = getBasenameWithoutExtension(getBasename(originalFilePath))
  return path.join(dir, String(size), `${base}.webp`)
}

const ensureKey = (
  txId: string | undefined,
  fileName: string | undefined,
  sizes: ImageSize[],
): string => {
  const idPart = txId ?? fileName ?? ''
  return `${idPart}|${sizes.join(',')}`
}

const runEnsureImageLocal = async (
  params: EnsureImageLocalParams,
): Promise<EnsureImageLocalResult> => {
  if (!supportsOpfsFileDownloads()) {
    return { status: 'unsupported' }
  }

  const fileName = params.fileName?.trim() || undefined
  const txId =
    normalizeArweaveTxIdForEnsure(params.transactionId) ??
    normalizeArweaveTxIdForEnsure(fileName)

  if (!txId && !fileName) {
    return { status: 'missing-id' }
  }

  const targetSizes = mapRequestedWidthsToImageSizes(params.widths)
  const needles = [fileName, txId].filter(
    (n): n is string => typeof n === 'string' && n.length > 0,
  )

  try {
    let filePath: string | undefined
    for (const needle of needles) {
      filePath = await resolveMatchingImagePath(needle)
      if (filePath) break
    }

    if (!filePath && txId) {
      await downloadTransactionIdWithDedupe(txId)
      for (const needle of needles) {
        filePath = await resolveMatchingImagePath(needle)
        if (filePath) break
      }
      // Downloads store as bare tx id
      if (!filePath) {
        const direct = BaseFileManager.getFilesPath('images', txId)
        if (await BaseFileManager.pathExists(direct)) {
          filePath = direct
        }
      }
    }

    if (!filePath) {
      return { status: 'failed' }
    }

    const createdWidths: number[] = []
    for (const size of targetSizes) {
      const variantPath = sizedVariantPath(filePath, size)
      const exists = await BaseFileManager.pathExists(variantPath)
      if (exists) continue
      await BaseFileManager.resizeImage({
        filePath,
        width: size,
        height: size,
      })
      createdWidths.push(size)
    }

    return {
      status: 'ready',
      filePath,
      createdWidths,
    }
  } catch (error) {
    logger('ensureImageLocal failed', error)
    return { status: 'failed' }
  }
}

/**
 * Ensure an image original exists in OPFS (downloading from Arweave if needed)
 * and create only the requested ImageSize variant(s) for that one file.
 */
export const ensureImageLocal = async (
  params: EnsureImageLocalParams,
): Promise<EnsureImageLocalResult> => {
  if (!supportsOpfsFileDownloads()) {
    return { status: 'unsupported' }
  }

  const fileName = params.fileName?.trim() || undefined
  const txId =
    normalizeArweaveTxIdForEnsure(params.transactionId) ??
    normalizeArweaveTxIdForEnsure(fileName)

  if (!txId && !fileName) {
    return { status: 'missing-id' }
  }

  const targetSizes = mapRequestedWidthsToImageSizes(params.widths)
  const key = ensureKey(txId, fileName, targetSizes)

  const existing = inFlightByKey.get(key)
  if (existing) {
    return existing
  }

  const inFlight = (async () => {
    try {
      return await runEnsureImageLocal({
        transactionId: txId,
        fileName,
        widths: targetSizes,
      })
    } finally {
      inFlightByKey.delete(key)
    }
  })()

  inFlightByKey.set(key, inFlight)
  return inFlight
}

/** Test-only: clear in-flight dedupe map. */
export const resetEnsureImageLocalInFlightForTests = (): void => {
  inFlightByKey.clear()
}
