import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { useIsClientReady } from './client'
import { eventEmitter } from '@/eventBus'

const IMAGE_FILES_QUERY_KEY = ['seed', 'imageFiles'] as const

/**
 * Returns an up-to-date list of image filenames stored in the file system (OPFS in browser).
 * Automatically refetches when images are saved (file-saved) or after bulk downloads (fs.downloadAll.success).
 *
 * Must be used within SeedProvider and after client.init().
 *
 * @example
 * ```tsx
 * const { imageFiles, isLoading, error, refetch } = useImageFiles()
 * // imageFiles: ['photo.jpg', 'cover.png']
 * ```
 */
export function useImageFiles() {
  const isClientReady = useIsClientReady()
  const queryClient = useQueryClient()

  const {
    data: imageFiles = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: IMAGE_FILES_QUERY_KEY,
    queryFn: () => BaseFileManager.listImageFiles(),
    enabled: isClientReady,
  })

  useEffect(() => {
    const fileSavedHandler = (filePath: string) => {
      if (filePath.includes('/images/')) {
        queryClient.invalidateQueries({ queryKey: IMAGE_FILES_QUERY_KEY })
      }
    }
    const downloadSuccessHandler = () => {
      queryClient.invalidateQueries({ queryKey: IMAGE_FILES_QUERY_KEY })
    }
    eventEmitter.on('file-saved', fileSavedHandler)
    eventEmitter.on('fs.downloadAll.success', downloadSuccessHandler)
    return () => {
      eventEmitter.off('file-saved', fileSavedHandler)
      eventEmitter.off('fs.downloadAll.success', downloadSuccessHandler)
    }
  }, [queryClient])

  return {
    imageFiles,
    isLoading,
    error: error instanceof Error ? error : null,
    refetch,
  }
}
