import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
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
})
