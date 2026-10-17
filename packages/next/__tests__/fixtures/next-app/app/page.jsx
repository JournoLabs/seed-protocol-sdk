'use client'

import { useState } from 'react'
import { useCreateItem, useItems } from '@seedprotocol/react'

export default function Page() {
  const { createItem } = useCreateItem()
  const { items, isLoading } = useItems({ modelName: 'Note' })
  const [created, setCreated] = useState('')

  return (
    <main>
      <p data-testid="ready">client ready</p>
      <button
        data-testid="create"
        onClick={async () => {
          const item = await createItem('Note', { title: 'fixture note' })
          setCreated(item?.seedLocalId ?? 'none')
        }}
      >
        Create note
      </button>
      <p data-testid="created">{created}</p>
      <p data-testid="count">{isLoading ? 'loading' : items.length}</p>
    </main>
  )
}
