import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { SeedMediaFile } from '../src/SeedMediaFile'

describe('SeedMediaFile', () => {
  it('renders anchor with resolved https href', async () => {
    render(
      <SeedMediaFile
        value="https://cdn.example/files/report.pdf"
        data-testid="link"
      />,
    )
    const a = await screen.findByTestId('link')
    expect(a).toHaveAttribute('href', 'https://cdn.example/files/report.pdf')
    expect(a).toHaveTextContent('report.pdf')
    expect(a).toHaveAttribute('target', '_blank')
    expect(a).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('uses children as link text when provided', async () => {
    render(
      <SeedMediaFile value="https://a.test/x.zip" data-testid="link">
        Download archive
      </SeedMediaFile>,
    )
    const a = await screen.findByTestId('link')
    expect(a).toHaveTextContent('Download archive')
  })

  it('uses render prop when provided', async () => {
    render(
      <SeedMediaFile
        value="https://a.test/doc.txt"
        render={(p) => <a data-testid="custom" {...p} className="file-link" />}
      />,
    )
    const a = await screen.findByTestId('custom')
    expect(a).toHaveClass('file-link')
    expect(a).toHaveAttribute('href', 'https://a.test/doc.txt')
  })
})
