import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import {
  useResolvedMediaRef,
  SeedMediaImage,
  useNormalizedFeedItemFields,
} from '../src/index'

function HookProbe({ value }: { value: string }) {
  const { href, status } = useResolvedMediaRef({ value })
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="href">{href ?? ''}</span>
    </div>
  )
}

function NormalizedProbe() {
  const item = { featureImage: 'https://a.test/x.jpg' }
  const manifest = { featureImage: { role: 'image' as const } }
  const n = useNormalizedFeedItemFields(item, manifest)
  const f = n.featureImage
  return (
    <span data-testid="kind">
      {f && f.role === 'image' ? f.classification.kind : 'none'}
    </span>
  )
}

function LoggingProbe({ value, log }: { value: string; log: { value: string; href?: string; status: string }[] }) {
  const { href, status } = useResolvedMediaRef({ value })
  log.push({ value, href, status })
  return <span data-testid="href">{href ?? ''}</span>
}

describe('useResolvedMediaRef', () => {
  it('resolves https URL to href (direct)', async () => {
    render(<HookProbe value="https://example.com/img.png" />)
    expect(await screen.findByTestId('status')).toHaveTextContent('ready')
    expect(screen.getByTestId('href')).toHaveTextContent('https://example.com/img.png')
  })

  it('never returns the previous value\'s href after the value changes', async () => {
    const first = 'https://example.com/first.png'
    const second = 'https://example.com/second.png'
    const log: { value: string; href?: string; status: string }[] = []
    const { rerender } = render(<LoggingProbe value={first} log={log} />)
    await waitFor(() => expect(screen.getByTestId('href')).toHaveTextContent(first))

    rerender(<LoggingProbe value={second} log={log} />)
    await waitFor(() => expect(screen.getByTestId('href')).toHaveTextContent(second))

    const afterChange = log.filter((r) => r.value === second)
    expect(afterChange.length).toBeGreaterThan(0)
    for (const r of afterChange) {
      expect(r.href === undefined || r.href === second).toBe(true)
      if (r.href === undefined) expect(r.status).toBe('loading')
    }
  })
})

describe('SeedMediaImage', () => {
  it('renders img with resolved src', async () => {
    render(<SeedMediaImage value="https://cdn.example/z.png" alt="Z" data-testid="img" />)
    const img = await screen.findByTestId('img')
    expect(img).toHaveAttribute('src', 'https://cdn.example/z.png')
    expect(img).toHaveAttribute('alt', 'Z')
  })

  it('uses render prop when provided', async () => {
    render(
      <SeedMediaImage
        value="https://cdn.example/z.png"
        render={(p) => <img data-testid="custom" {...p} className="wrap" />}
      />,
    )
    const img = await screen.findByTestId('custom')
    expect(img).toHaveClass('wrap')
    expect(img).toHaveAttribute('src', 'https://cdn.example/z.png')
  })
})

describe('useNormalizedFeedItemFields', () => {
  it('classifies fields synchronously', async () => {
    render(<NormalizedProbe />)
    expect(await screen.findByTestId('kind')).toHaveTextContent('url')
  })
})
