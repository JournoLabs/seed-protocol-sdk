/**
 * @vitest-environment jsdom
 */
import { createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { describe, expect, it, vi } from 'vitest'
import { useFieldMapper } from '../src/react/useFieldMapper'
import type { FieldMapping, SourceNode, TargetProperty } from '../src/types'

const sources: SourceNode[] = [
  { id: 'rss-title', label: 'title', kind: 'rssField', value: 'Hello' },
  { id: 'rss-link', label: 'link', kind: 'rssField', value: 'https://example.org/post' },
  { id: 'rss-html', label: 'content', kind: 'rssField', value: '<p>Hi</p>' },
]

const targets: TargetProperty[] = [
  { name: 'title', dataType: 'String', required: true },
  { name: 'html', dataType: 'Html', required: true },
  { name: 'slug', dataType: 'String', required: true },
  { name: 'importUrl', dataType: 'String' },
]

const initialMappings: FieldMapping[] = [
  { sourceId: 'rss-title', propertyName: 'title' },
  { sourceId: 'rss-html', propertyName: 'html' },
  { sourceId: 'rss-link', propertyName: 'importUrl' },
]

function namesOf(mappings: FieldMapping[]): string[] {
  return mappings.map((m) => m.propertyName)
}

function renderHook<Props, Result>(
  callback: (props: Props) => Result,
  options: { initialProps: Props },
): {
  result: { current: Result }
  rerender: (props: Props) => void
  unmount: () => void
} {
  const container = document.createElement('div')
  document.body.appendChild(container)
  let props = options.initialProps
  let latest: Result
  let root: Root

  function Probe(): ReactNode {
    latest = callback(props)
    return null
  }

  root = createRoot(container)
  flushSync(() => {
    root.render(createElement(Probe))
  })

  return {
    result: {
      get current() {
        return latest
      },
    },
    rerender(next: Props) {
      props = next
      flushSync(() => {
        root.render(createElement(Probe))
      })
    },
    unmount() {
      flushSync(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}

describe('useFieldMapper write-through mappingsRef', () => {
  it('two removeRow calls without a rerender do not resurrect the first-removed edge', () => {
    const onChange = vi.fn()
    const { result, unmount } = renderHook(
      () =>
        useFieldMapper({
          sources,
          targets,
          mappings: initialMappings,
          onChange,
          rowKey: 'property',
        }),
      { initialProps: undefined },
    )

    result.current.removeRow('title')
    result.current.removeRow('importUrl')

    expect(onChange).toHaveBeenCalledTimes(2)
    expect(namesOf(onChange.mock.calls[0][0])).toEqual(['html', 'importUrl'])
    expect(namesOf(onChange.mock.calls[1][0])).toEqual(['html'])
    unmount()
  })

  it('after a host-stripped importUrl, removeRow does not send importUrl back', () => {
    const onChange = vi.fn()
    const { result, rerender, unmount } = renderHook(
      ({ mappings }: { mappings: FieldMapping[] }) =>
        useFieldMapper({
          sources,
          targets,
          mappings,
          onChange,
          rowKey: 'property',
        }),
      { initialProps: { mappings: initialMappings } },
    )

    const hostStripped = initialMappings.filter((m) => m.propertyName !== 'importUrl')
    rerender({ mappings: hostStripped })
    result.current.removeRow('title')

    const last = onChange.mock.calls.at(-1)?.[0] as FieldMapping[]
    expect(namesOf(last)).toEqual(['html'])
    expect(namesOf(last)).not.toContain('importUrl')
    unmount()
  })
})
