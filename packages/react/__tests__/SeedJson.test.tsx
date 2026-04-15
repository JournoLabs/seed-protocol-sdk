import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { SeedJson, formatSeedJson } from '../src/index'

describe('formatSeedJson', () => {
  it('stringifies plain objects', () => {
    const s = formatSeedJson({ a: 1, b: 'two' })
    expect(s).toContain('"a"')
    expect(s).toContain('1')
    expect(s).toContain('"two"')
  })

  it('detects circular references', () => {
    const o: Record<string, unknown> = { x: 1 }
    o.self = o
    const s = formatSeedJson(o)
    expect(s).toContain('[Circular]')
  })

  it('truncates long strings with maxStringLength', () => {
    const s = formatSeedJson('0123456789hello', { maxStringLength: 10 })
    expect(s).toBe('0123456789…')
  })

  it('returns invalid JSON-looking string as truncated text when parse fails', () => {
    const raw = '{"broken":'
    const s = formatSeedJson(raw, { maxStringLength: 100 })
    expect(s).toBe(raw)
  })

  it('parses JSON object strings', () => {
    const s = formatSeedJson('{"k":"v"}')
    expect(s).toContain('"k"')
    expect(s).toContain('"v"')
  })
})

describe('SeedJson', () => {
  it('renders formatted JSON in pre', () => {
    render(<SeedJson value={{ n: 42 }} data-testid="pre" />)
    const pre = screen.getByTestId('pre')
    expect(pre.tagName).toBe('PRE')
    expect(pre.textContent).toContain('42')
  })

  it('uses custom format when provided', () => {
    render(<SeedJson value={{}} format={() => 'CUSTOM'} data-testid="pre" />)
    expect(screen.getByTestId('pre')).toHaveTextContent('CUSTOM')
  })

  it('uses render prop', () => {
    render(
      <SeedJson
        value={{ a: 1 }}
        render={({ text }) => <code data-testid="code">{text}</code>}
      />,
    )
    expect(screen.getByTestId('code').textContent).toContain('"a"')
  })
})
