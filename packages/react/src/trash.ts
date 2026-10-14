import { useCallback, useState } from 'react'
import { Item } from '@seedprotocol/sdk'

export type UseDeleteItemReturn = {
  deleteItem: (item: Item<any>) => Promise<void>
  isLoading: boolean
  error: Error | null
  resetError: () => void
}

export const useDeleteItem = (): UseDeleteItemReturn => {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  // Loading state is tracked here: the item's service doesn't record destroy progress, and
  // destroy() stops the service, often within a few microtasks.
  const destroy = useCallback(async (item: Item<any>) => {
    if (!item) return
    setError(null)
    setIsLoading(true)
    try {
      await item.destroy()
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [])

  const resetError = useCallback(() => setError(null), [])

  return {
    deleteItem: destroy,
    isLoading,
    error,
    resetError,
  }
}
