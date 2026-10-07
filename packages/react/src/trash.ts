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

  // Loading state is tracked here rather than read from the item's service: destroy() sends
  // destroyStarted and destroyDone (then stops the service) before an effect could subscribe,
  // so a fast destroy would never surface isLoading: true.
  const destroy = useCallback(async (item: Item<any>) => {
    if (!item) return
    setError(null)
    setIsLoading(true)
    try {
      await item.destroy()
      // destroy() reports DB failures via the service context instead of throwing
      const ctx = item.getService().getSnapshot().context as { _destroyError?: { message: string } | null }
      if (ctx._destroyError) setError(new Error(ctx._destroyError.message))
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
