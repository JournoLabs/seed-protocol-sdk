import { useCallback, useEffect, useState } from 'react'
import { Item } from '@/Item/Item'

export type UseDeleteItemReturn = {
  deleteItem: (item: Item<any>) => Promise<void>
  isLoading: boolean
  error: Error | null
  resetError: () => void
}

export const useDeleteItem = (): UseDeleteItemReturn => {
  const [currentInstance, setCurrentInstance] = useState<Item<any> | null>(null)
  const [destroyState, setDestroyState] = useState<{ isLoading: boolean; error: Error | null }>({
    isLoading: false,
    error: null,
  })

  useEffect(() => {
    if (!currentInstance) {
      setDestroyState({ isLoading: false, error: null })
      return
    }
    const service = currentInstance.getService()
    const update = () => {
      const snap = service.getSnapshot()
      const ctx = snap.context as { _destroyInProgress?: boolean; _destroyError?: { message: string } | null }
      setDestroyState({
        isLoading: !!ctx._destroyInProgress,
        error: ctx._destroyError ? new Error(ctx._destroyError.message) : null,
      })
    }
    update()
    const sub = service.subscribe(update)
    return () => sub.unsubscribe()
  }, [currentInstance])

  const destroy = useCallback(async (item: Item<any>) => {
    if (!item) return
    setCurrentInstance(item)
    await item.destroy()
  }, [])

  const resetError = useCallback(() => {
    if (currentInstance) {
      currentInstance.getService().send({ type: 'clearDestroyError' })
    }
  }, [currentInstance])

  return {
    deleteItem: destroy,
    isLoading: destroyState.isLoading,
    error: destroyState.error,
    resetError,
  }
}
