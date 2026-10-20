import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSeedQueryClient } from './queryClient'
import { BaseFileManager, eventEmitter, FILES_CHANGED_EVENT } from '@seedprotocol/sdk'
import { useIsClientReady } from './client'

export const FILES_QUERY_KEY_PREFIX = ['seed', 'files'] as const

/**
 * Returns an up-to-date list of filenames stored in the given directory.
 * Refetches when a file in the directory is saved, here or by a worker or another tab.
 *
 * Use within SeedProvider, after client.init().
 *
 * @param dir - Directory name under the files root (e.g. 'files', 'images'). Default: 'files'.
 *
 * @example
 * ```tsx
 * const { files, isLoading, error, refetch } = useFiles('files')
 * // files: ['document.pdf', 'contract.docx']
 * ```
 */
export function useFiles(dir: string = 'files') {
  const isClientReady = useIsClientReady()
  const queryClient = useSeedQueryClient()

  const queryKey = useMemo(() => [...FILES_QUERY_KEY_PREFIX, dir] as const, [dir])

  const {
    data: files = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey,
    queryFn: () => BaseFileManager.listFiles(dir),
    enabled: isClientReady,
  }, queryClient)

  useEffect(() => {
    const fileSavedHandler = (filePath: string) => {
      if (filePath.includes(`/${dir}/`)) {
        queryClient.invalidateQueries({ queryKey })
      }
    }
    // Files written by workers or other tabs.
    const filesChangedHandler = (filePaths: string[]) => {
      if (filePaths.some((filePath) => filePath.includes(`/${dir}/`))) {
        queryClient.invalidateQueries({ queryKey })
      }
    }
    eventEmitter.on('file-saved', fileSavedHandler)
    eventEmitter.on(FILES_CHANGED_EVENT, filesChangedHandler)
    return () => {
      eventEmitter.off('file-saved', fileSavedHandler)
      eventEmitter.off(FILES_CHANGED_EVENT, filesChangedHandler)
    }
  }, [queryClient, dir, queryKey])

  return {
    files,
    isLoading,
    error: error instanceof Error ? error : null,
    refetch,
  }
}
