import { useCallback, useEffect, useState } from 'react'
import { getOPFSFile } from '../opfsPaths'
import { fileKind, type FileEntry } from './fileModel'

/** Thumbnails are drawn at about 2× the largest tile width. */
const THUMBNAIL_WIDTH = 400
/** Originals smaller than this are shown as-is instead of being resized first. */
const RESIZE_THRESHOLD_BYTES = 256 * 1024
const MAX_CONCURRENT_DECODES = 4
/** Keep an unused thumbnail's object URL around briefly so switching views doesn't reload it. */
const RELEASE_DELAY_MS = 30_000

let activeJobs = 0
const queue: Array<() => void> = []

function schedule<T>(job: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      activeJobs++
      job()
        .then(resolve, reject)
        .finally(() => {
          activeJobs--
          queue.shift()?.()
        })
    }
    if (activeJobs < MAX_CONCURRENT_DECODES) run()
    else queue.push(run)
  })
}

interface CacheEntry {
  promise: Promise<string>
  url?: string
  refs: number
  timer?: ReturnType<typeof setTimeout>
}

const cache = new Map<string, CacheEntry>()

function acquire(key: string, create: () => Promise<Blob>): { promise: Promise<string>; release: () => void } {
  let entry = cache.get(key)
  if (!entry) {
    const created: CacheEntry = { refs: 0, promise: Promise.resolve('') }
    created.promise = schedule(create).then((blob) => {
      created.url = URL.createObjectURL(blob)
      return created.url
    })
    cache.set(key, created)
    entry = created
  }
  if (entry.timer) {
    clearTimeout(entry.timer)
    entry.timer = undefined
  }
  entry.refs++
  const held = entry
  let released = false
  return {
    promise: held.promise,
    release: () => {
      if (released) return
      released = true
      held.refs--
      if (held.refs > 0) return
      held.timer = setTimeout(() => {
        if (held.url) URL.revokeObjectURL(held.url)
        if (cache.get(key) === held) cache.delete(key)
      }, RELEASE_DELAY_MS)
    },
  }
}

async function resizeImage(blob: Blob): Promise<Blob> {
  if (blob.size < RESIZE_THRESHOLD_BYTES || typeof createImageBitmap !== 'function') return blob
  const bitmap = await createImageBitmap(blob, { resizeWidth: THUMBNAIL_WIDTH, resizeQuality: 'medium' })
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
      return await canvas.convertToBlob({ type: 'image/webp', quality: 0.82 })
    }
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas export failed'))), 'image/webp', 0.82),
    )
  } finally {
    bitmap.close()
  }
}

/**
 * Prefer the narrowest resized copy the SDK already wrote (480w WebP); it needs no
 * decoding on our side. Otherwise read the original and downscale it.
 */
async function createThumbnail(entry: FileEntry): Promise<Blob> {
  const variant = entry.variants[0]
  if (variant) return getOPFSFile(variant.file.path)
  return resizeImage(await getOPFSFile(entry.file.path))
}

// One IntersectionObserver for every tile.
type VisibilityCallback = () => void
const visibilityCallbacks = new WeakMap<Element, VisibilityCallback>()
let observer: IntersectionObserver | null = null

function observeOnce(el: Element, onVisible: VisibilityCallback): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    onVisible()
    return () => {}
  }
  observer ??= new IntersectionObserver(
    (records) => {
      for (const record of records) {
        if (!record.isIntersecting) continue
        observer!.unobserve(record.target)
        visibilityCallbacks.get(record.target)?.()
        visibilityCallbacks.delete(record.target)
      }
    },
    { rootMargin: '300px' },
  )
  visibilityCallbacks.set(el, onVisible)
  observer.observe(el)
  return () => {
    visibilityCallbacks.delete(el)
    observer?.unobserve(el)
  }
}

export type ThumbnailStatus = 'idle' | 'loading' | 'ready' | 'error'

/**
 * Lazily load a thumbnail object URL for an image entry once its element scrolls near
 * the viewport. Returns `status: 'idle'` for non-images.
 */
export function useThumbnail(entry: FileEntry) {
  const isImage = fileKind(entry.file) === 'image'
  const [element, setElement] = useState<Element | null>(null)
  const [visible, setVisible] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<ThumbnailStatus>('idle')

  const ref = useCallback((el: Element | null) => setElement(el), [])

  useEffect(() => {
    if (!isImage || !element || visible) return
    return observeOnce(element, () => setVisible(true))
  }, [isImage, element, visible])

  const { path, lastModified, size } = entry.file
  const variantPath = entry.variants[0]?.file.path
  const key = `${path}:${lastModified}:${size}:${variantPath ?? ''}`

  useEffect(() => {
    if (!isImage || !visible) return
    let cancelled = false
    setStatus('loading')
    const handle = acquire(key, () => createThumbnail(entry))
    handle.promise.then(
      (u) => {
        if (cancelled) return
        setUrl(u)
        setStatus('ready')
      },
      () => {
        if (!cancelled) setStatus('error')
      },
    )
    return () => {
      cancelled = true
      handle.release()
    }
    // entry identity changes on every refetch; key captures what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isImage, visible, key])

  /** Call from <img onError> when the browser can't decode the thumbnail. */
  const markError = useCallback(() => setStatus('error'), [])

  return { ref, url: status === 'ready' ? url : null, status, markError }
}
