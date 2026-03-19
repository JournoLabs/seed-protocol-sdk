import { useState, useCallback, useEffect } from 'react'

export interface OPFSFile {
  name: string
  path: string
  size: number
  type: string
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
          foundFiles.push({
            name,
            path: currentPath,
            size: file.size,
            type: file.type || 'application/octet-stream',
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
 * @example
 * ```tsx
 * const { files, isLoading, error, refetch } = useOPFSFiles()
 * ```
 */
export function useOPFSFiles(options: UseOPFSFilesOptions = {}) {
  const { rootPath } = options
  const [files, setFiles] = useState<OPFSFile[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const root = await navigator.storage.getDirectory()
      let dirHandle: FileSystemDirectoryHandle = root

      if (rootPath) {
        const parts = rootPath.split('/').filter(Boolean)
        for (const part of parts) {
          dirHandle = await dirHandle.getDirectoryHandle(part)
        }
      }

      const allFiles = await scanDirectory(dirHandle, rootPath || '')
      setFiles(allFiles.sort((a, b) => a.path.localeCompare(b.path)))
    } catch (err) {
      setError(
        'Failed to access OPFS: ' + (err instanceof Error ? err.message : String(err))
      )
      console.error('OPFS access error:', err)
    } finally {
      setIsLoading(false)
    }
  }, [rootPath])

  useEffect(() => {
    load()
  }, [load])

  return { files, isLoading, error, refetch: load }
}
