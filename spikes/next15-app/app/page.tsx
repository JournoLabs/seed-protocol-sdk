'use client'

import { useEffect, useState } from 'react'
import { useCreateItem, useItems } from '@seedprotocol/react'

export default function Page() {
  const { createItem, error } = useCreateItem()
  const { items, isLoading } = useItems({ modelName: 'Note' })
  const [created, setCreated] = useState<string | null>(null)
  const [isolated, setIsolated] = useState('')
  useEffect(() => setIsolated(String(window.crossOriginIsolated)), [])

  return (
    <main>
      <p data-testid="ready">client ready</p>
      <p data-testid="isolated">{isolated}</p>
      <button
        data-testid="create"
        onClick={async () => {
          const item = await createItem('Note', { title: `note ${Date.now()}` })
          setCreated(item?.seedLocalId ?? 'undefined')
        }}
      >
        Create note
      </button>
      <p data-testid="created">{created}</p>
      <p data-testid="error">{error?.message}</p>
      <p data-testid="count">{isLoading ? 'loading' : items.length}</p>
    </main>
  )
}
