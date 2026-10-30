import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { getArweaveReadBaseUrls } from '@seedprotocol/sdk'
import { SeedHtml } from '../src/SeedHtml'

describe('SeedHtml', () => {
  it('invokes sanitize and renders sanitized HTML in a div', () => {
    const sanitize = vi.fn((s: string) => s.replace(/BAD/g, ''))
    render(
      <SeedHtml
        html="<p>BADok</p>"
        sanitize={sanitize}
        data-testid="wrap"
      />,
    )
    expect(sanitize).toHaveBeenCalledWith('<p>BADok</p>')
    const el = screen.getByTestId('wrap')
    expect(el.innerHTML).toBe('<p>ok</p>')
  })

  it('renders nothing when html is null, undefined, or empty', () => {
    const sanitize = vi.fn((s: string) => s)
    const { rerender, container } = render(<SeedHtml html={null} sanitize={sanitize} />)
    expect(container.firstChild).toBeNull()
    expect(sanitize).not.toHaveBeenCalled()

    rerender(<SeedHtml html={undefined} sanitize={sanitize} />)
    expect(container.firstChild).toBeNull()

    rerender(<SeedHtml html="" sanitize={sanitize} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when html is whitespace-only (ASCII only)', () => {
    const sanitize = vi.fn((s: string) => s)
    const onlyWhitespace = `${' '.repeat(3)}\n\t${' '.repeat(2)}`
    const { container } = render(<SeedHtml html={onlyWhitespace} sanitize={sanitize} />)
    expect(container.firstChild).toBeNull()
    expect(sanitize).not.toHaveBeenCalled()
  })

  it('passes sanitized html to render prop for custom containers', () => {
    const sanitize = vi.fn((s: string) => `<b>${s}</b>`)
    render(
      <SeedHtml
        html="hi"
        sanitize={sanitize}
        render={({ html }) => (
          <article data-testid="article" dangerouslySetInnerHTML={{ __html: html }} />
        )}
      />,
    )
    expect(sanitize).toHaveBeenCalledWith('hi')
    const article = screen.getByTestId('article')
    expect(article.tagName).toBe('ARTICLE')
    expect(article.innerHTML).toBe('<b>hi</b>')
  })

  describe('Arweave links (ADR 0025)', () => {
    const TX = 'seedHtmlTx'.padEnd(43, 'w')

    it('moves Arweave links onto the first read gateway before sanitize runs', () => {
      const sanitize = vi.fn((s: string) => s)
      render(<SeedHtml html={`<img src="ar://${TX}">`} sanitize={sanitize} data-testid="wrap" />)
      const [first] = getArweaveReadBaseUrls()
      expect(sanitize).toHaveBeenCalledWith(`<img src="${first}/raw/${TX}">`)
    })

    it('moves an image that fails to load to the next read gateway', () => {
      const [first, second] = getArweaveReadBaseUrls()
      expect(second).toBeTruthy()
      render(<SeedHtml html={`<img src="${first}/raw/${TX}">`} sanitize={(s) => s} data-testid="wrap" />)
      const img = screen.getByTestId('wrap').querySelector('img')!
      img.dispatchEvent(new Event('error'))
      expect(img.getAttribute('src')).toBe(`${second}/raw/${TX}`)
    })
  })
})
