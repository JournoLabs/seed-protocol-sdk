import { useState, useCallback, useEffect } from 'react'
import { detectMimeType, resolveDirectoryHandle } from './opfsPaths'

export interface OPFSFile {
  name: string
  path: string
  size: number
  /** `File.type`, which OPFS derives from the extension. 'application/octet-stream' when unknown. */
  type: string
  /**
   * Type detected from the file's leading bytes, set only when `File.type` is empty
   * (e.g. images saved under an Arweave transaction ID with no extension).
   */
  detectedType?: string
  lastModified: number
}

async function scanDirectory(
  dirHandle: FileSystemDirectoryHandle,
  basePath: string = ''
): Promise<OPFSFile[]> {
  const foundFiles: OPFSFile[] = []

  try {
    for await (const [name, handle] of dirHandle.entries()) {
      const currentPath = basePath ? `${basePath}/${name}` : name

      if (handle.kind === 'file') {
        try {
          const file = await (handle as FileSystemFileHandle).getFile()
          const detectedType = file.type ? undefined : await detectMimeType(file).catch(() => undefined)
          foundFiles.push({
            name,
            path: currentPath,
            size: file.size,
            type: file.type || 'application/octet-stream',
            ...(detectedType && { detectedType }),
            lastModified: file.lastModified,
          })
        } catch (err) {
          console.warn(`Failed to read file ${currentPath}:`, err)
        }
      } else if (handle.kind === 'directory') {
        const subFiles = await scanDirectory(handle as FileSystemDirectoryHandle, currentPath)
        foundFiles.push(...subFiles)
      }
    }
  } catch (err) {
    console.warn(`Failed to scan directory ${basePath}:`, err)
  }

  return foundFiles
}

export interface UseOPFSFilesOptions {
  /** Optional subdirectory to scan (e.g. 'app-files'). Default: root. */
  rootPath?: string
}

/**
 * Hook to scan and list all files in OPFS (Origin Private File System).
 * Uses navigator.storage.getDirectory() - works in browsers that support OPFS.
 *
 * `isLoading` is true during every scan, including refetches; `files` keeps the
 * previous result until the new scan finishes.
 *
 * @example
 * ```tsx
 * const { files, isLoading, error, refetch } = useOPFSFiles()
 * ```
 */
export function useOPFSFiles(options: UseOPFSFilesOptions = {}) {
  const { rootPath } = options
  const [files, setFiles] = useState<OPFSFile[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorName, setErrorName] = useState<string | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    setErrorName(null)

    try {
      const dirHandle = await resolveDirectoryHandle(rootPath ?? '')
      const allFiles = await scanDirectory(dirHandle, rootPath || '')
      setFiles(allFiles.sort((a, b) => a.path.localeCompare(b.path)))
    } catch (err) {
      setError(
        'Failed to access OPFS: ' + (err instanceof Error ? err.message : String(err))
      )
      setErrorName(err instanceof Error ? err.name : null)
      console.error('OPFS access error:', err)
    } finally {
      setIsLoading(false)
      setHasLoaded(true)
    }
  }, [rootPath])

  useEffect(() => {
    load()
  }, [load])

  return {
    files,
    isLoading,
    /** False until the first scan finishes. */
    hasLoaded,
    error,
    /** The thrown error's name, e.g. 'NotFoundError' when `rootPath` doesn't exist. */
    errorName,
    refetch: load,
  }
}
