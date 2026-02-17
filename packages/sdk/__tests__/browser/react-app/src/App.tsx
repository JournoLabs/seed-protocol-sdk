import React, { useEffect, useState } from 'react'
import { client } from '@seedprotocol/sdk'

export default function App() {
  const [clientStatus, setClientStatus] = useState<string>('Checking...')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    try {
      // Test that we can import and access the client
      const isInitialized = client.isInitialized()
      setClientStatus(isInitialized ? 'Initialized' : 'Not Initialized')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setClientStatus('Error')
    }
  }, [])

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1>Seed Protocol SDK - React Test App</h1>
      <div style={{ marginTop: '20px' }}>
        <h2>Client Status:</h2>
        <p data-testid="client-status">{clientStatus}</p>
        {error && (
          <p data-testid="error" style={{ color: 'red' }}>
            Error: {error}
          </p>
        )}
        <div style={{ marginTop: '20px' }}>
          <p>Client instance: {client ? '✓ Available' : '✗ Not available'}</p>
        </div>
      </div>
    </div>
  )
}

