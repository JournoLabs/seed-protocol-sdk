import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSeedQueryClient } from './queryClient'
import { BaseFileManager } from '@seedprotocol/sdk'
import { useIsClientReady } from './client'
import { eventEmitter, FILES_CHANGED_EVENT } from '@seedprotocol/sdk'

const IMAGE_FILES_QUERY_KEY = ['seed', 'imageFiles'] as const

/**
 * Returns an up-to-date list of image filenames stored in the file system (OPFS in browser).
 * Automatically refetches when images are saved (file-saved) or after bulk downloads (fs.downloadAll.success).
 *
 * Use within SeedProvider, after client.init().
 *
 * @example
 * ```tsx
 * const { imageFiles, isLoading, error, refetch } = useImageFiles()
 * // imageFiles: ['photo.jpg', 'cover.png']
 * ```
 */
export function useImageFiles() {
  const isClientReady = useIsClientReady()
  const queryClient = useSeedQueryClient()

  const {
    data: imageFiles = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: IMAGE_FILES_QUERY_KEY,
    queryFn: () => BaseFileManager.listImageFiles(),
    enabled: isClientReady,
  }, queryClient)

  useEffect(() => {
    const fileSavedHandler = (filePath: string) => {
      if (filePath.includes('/images/')) {
        queryClient.invalidateQueries({ queryKey: IMAGE_FILES_QUERY_KEY })
      }
    }
    const downloadSuccessHandler = () => {
      queryClient.invalidateQueries({ queryKey: IMAGE_FILES_QUERY_KEY })
    }
    // Files written by workers or other tabs.
    const filesChangedHandler = (filePaths: string[]) => {
      if (filePaths.some((filePath) => filePath.includes('/images/'))) {
        queryClient.invalidateQueries({ queryKey: IMAGE_FILES_QUERY_KEY })
      }
    }
    eventEmitter.on('file-saved', fileSavedHandler)
    eventEmitter.on('fs.downloadAll.success', downloadSuccessHandler)
    eventEmitter.on(FILES_CHANGED_EVENT, filesChangedHandler)
    return () => {
      eventEmitter.off('file-saved', fileSavedHandler)
      eventEmitter.off('fs.downloadAll.success', downloadSuccessHandler)
      eventEmitter.off(FILES_CHANGED_EVENT, filesChangedHandler)
    }
  }, [queryClient])

  return {
    imageFiles,
    isLoading,
    error: error instanceof Error ? error : null,
    refetch,
  }
}
