import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { applyMapping, applyMappingAsync } from '../src/applyMapping'
import {
  applyResolveToEdge,
  clearSourceKeepDerive,
  isPresentEdge,
  withPreservedExtras,
} from '../src/edgeMapping'
import { FieldMapper } from '../src/react/FieldMapper'
import {
  applyAssembleBlocksToMappings,
  applyDeriveToMappings,
  buildPropertyModeRows,
  computeCoverage,
  connectSourceToProperty,
  previewForEdge,
  upsertPropertyMapping,
} from '../src/react/fieldMapperCore'
import { defaultTransformOptions } from '../src/react/fieldMapperTransforms'
import type { FieldMapping, SourceNode, TargetProperty } from '../src/types'

const sources: SourceNode[] = [
  {
    id: 'rss-title',
    label: 'title',
    kind: 'rssField',
    value: 'The grid held, barely',
  },
  {
    id: 'rss-link',
    label: 'link',
    kind: 'rssField',
    value: 'https://example.org/post',
    meta: { url: 'https://example.org/post', class: 'html' },
  },
  {
    id: 'rss-slug',
    label: 'slug',
    kind: 'rssField',
    value: 'grid-held',
  },
]

const targets: TargetProperty[] = [
  { name: 'title', dataType: 'String', required: true },
  { name: 'html', dataType: 'Html', required: true },
  { name: 'slug', dataType: 'String', required: true },
]

function session(initial: FieldMapping[] = []) {
  let mappings = initial
  return {
    get mappings() {
      return mappings
    },
    set(next: FieldMapping[]) {
      mappings = next
    },
    setTransform(propertyName: string, resolve: FieldMapping['resolve'] | null) {
      const prev = mappings.find((m) => m.propertyName === propertyName)
      if (!prev) {
        if (resolve === 'derive') {
          mappings = upsertPropertyMapping(mappings, {
            propertyName,
            resolve: 'derive',
          })
        }
        return
      }
      mappings = upsertPropertyMapping(
        mappings,
        applyResolveToEdge(prev, resolve),
      )
    },
    setSource(propertyName: string, sourceId: string | null) {
      const prev = mappings.find((m) => m.propertyName === propertyName)
      if (!sourceId) {
        if (prev && (prev.resolve === 'derive' || prev.derive)) {
          mappings = upsertPropertyMapping(mappings, clearSourceKeepDerive(prev))
          return
        }
        mappings = mappings.filter((m) => m.propertyName !== propertyName)
        return
      }
      const result = connectSourceToProperty(
        mappings,
        sources,
        targets,
        sourceId,
        propertyName,
      )
      mappings = result.mappings
    },
  }
}

describe('derive / assemble persist', () => {
  it('keeps derive and assemble.blocks across copy/derive/assemble/extract', () => {
    const derive: FieldMapping = {
      sourceId: 'rss-slug',
      propertyName: 'slug',
      derive: { from: 'title', fallback: true },
    }
    expect(applyResolveToEdge(derive, 'derive')).toEqual({
      sourceId: 'rss-slug',
      propertyName: 'slug',
      resolve: 'derive',
      derive: { from: 'title', fallback: true },
    })
    expect(applyResolveToEdge(derive, null)).toEqual({
      sourceId: 'rss-slug',
      propertyName: 'slug',
      derive: { from: 'title', fallback: true },
    })

    const assembled: FieldMapping = {
      sourceId: 'rss-link',
      propertyName: 'html',
      resolve: 'assemble',
      assemble: { blocks: ['headline', 'body'] },
    }
    expect(applyResolveToEdge(assembled, 'assemble')).toEqual(assembled)
    expect(applyResolveToEdge(assembled, 'extract')).toEqual({
      sourceId: 'rss-link',
      propertyName: 'html',
      resolve: 'extract',
    })
    expect(applyResolveToEdge(assembled, null)).toEqual({
      sourceId: 'rss-link',
      propertyName: 'html',
    })
  })

  it('creates a source-less derive edge and omits empty sourceId', () => {
    const s = session()
    s.setTransform('slug', 'derive')
    expect(s.mappings).toEqual([{ propertyName: 'slug', resolve: 'derive' }])
    expect(s.mappings[0]).not.toHaveProperty('sourceId')
  })

  it('clearing source on a derive edge leaves derive-only; copy/assemble remove', () => {
    const derive = session([
      {
        sourceId: 'rss-slug',
        propertyName: 'slug',
        resolve: 'derive',
        derive: { from: 'title', fallback: true },
      },
    ])
    derive.setSource('slug', null)
    expect(derive.mappings).toEqual([
      {
        propertyName: 'slug',
        resolve: 'derive',
        derive: { from: 'title', fallback: true },
      },
    ])

    const copy = session([{ sourceId: 'rss-title', propertyName: 'title' }])
    copy.setSource('title', null)
    expect(copy.mappings).toEqual([])

    const assemble = session([
      {
        sourceId: 'rss-link',
        propertyName: 'html',
        resolve: 'assemble',
        assemble: { blocks: ['body'] },
      },
    ])
    assemble.setSource('html', null)
    expect(assemble.mappings).toEqual([])
  })

  it('reconnect keeps derive / assemble extras on the same property', () => {
    const next = withPreservedExtras(
      { sourceId: 'rss-slug', propertyName: 'slug' },
      {
        propertyName: 'slug',
        resolve: 'derive',
        derive: { from: 'title', fallback: true },
      },
    )
    expect(next).toEqual({
      sourceId: 'rss-slug',
      propertyName: 'slug',
      resolve: 'derive',
      derive: { from: 'title', fallback: true },
    })

    const html = connectSourceToProperty(
      [
        {
          sourceId: 'rss-title',
          propertyName: 'html',
          resolve: 'assemble',
          assemble: { blocks: ['headline', 'body'] },
        },
      ],
      sources,
      targets,
      'rss-link',
      'html',
    )
    expect(html.mappings).toEqual([
      {
        sourceId: 'rss-link',
        propertyName: 'html',
        resolve: 'assemble',
        assemble: { blocks: ['headline', 'body'] },
      },
    ])
  })

  it('setAssembleBlocks and setDerive write persist keys', () => {
    const assembled = applyAssembleBlocksToMappings(
      [
        {
          sourceId: 'rss-link',
          propertyName: 'html',
          resolve: 'assemble',
        },
      ],
      'property',
      'html',
      [],
      ['headline', 'body'],
    )
    expect(assembled?.[0]?.assemble).toEqual({
      blocks: ['headline', 'body'],
    })

    const derived = applyDeriveToMappings(
      [],
      'property',
      'slug',
      [],
      { from: 'title', fallback: true },
    )
    expect(derived).toEqual([
      {
        propertyName: 'slug',
        resolve: 'derive',
        derive: { from: 'title', fallback: true },
      },
    ])
  })
})

describe('derive / assemble coverage and row state', () => {
  it('counts a derive-only slug as mapped', () => {
    const mappings: FieldMapping[] = [
      { sourceId: 'rss-title', propertyName: 'title' },
      {
        propertyName: 'slug',
        resolve: 'derive',
        derive: { from: 'title', fallback: true },
      },
    ]
    expect(isPresentEdge(mappings[1]!)).toBe(true)
    const coverage = computeCoverage(targets, mappings)
    expect(coverage.mapped).toBe(2)
    expect(coverage.missingRequired).toEqual(['html'])

    const rows = buildPropertyModeRows({ targets, sources, mappings })
    const slug = rows.find((r) => r.id === 'slug')!
    expect(slug.state).toBe('mapped')
    expect(slug.mapping?.sourceId).toBeUndefined()
    expect(slug.preview).toBe('‹derive from title›')
  })

  it('does not flag URL → Html assemble as needs extract', () => {
    const rows = buildPropertyModeRows({
      targets,
      sources,
      mappings: [
        {
          sourceId: 'rss-link',
          propertyName: 'html',
          resolve: 'assemble',
          assemble: { blocks: ['headline', 'body'] },
        },
      ],
    })
    const html = rows.find((r) => r.id === 'html')!
    expect(html.requiredResolve).toBe('extract')
    expect(html.state).toBe('mapped')
    expect(html.preview).toBe('‹assemble headline, body›')
  })

  it('preview placeholders do not slugify', () => {
    expect(
      previewForEdge(undefined, 'derive', {
        mapping: { propertyName: 'slug', resolve: 'derive', derive: { from: 'title' } },
      }),
    ).toBe('‹derive from title›')
    expect(previewForEdge(sources[1], 'assemble')).toBe('‹assemble›')
  })
})

describe('applyMapping skips derive and assemble', () => {
  it('sync apply omits derive/assemble properties', () => {
    const bag = applyMapping(
      sources,
      [
        { sourceId: 'rss-title', propertyName: 'title' },
        {
          propertyName: 'slug',
          resolve: 'derive',
          derive: { from: 'title', fallback: true },
        },
        {
          sourceId: 'rss-link',
          propertyName: 'html',
          resolve: 'assemble',
          assemble: { blocks: ['body'] },
        },
      ],
      targets,
    )
    expect(bag).toEqual({ title: 'The grid held, barely' })
  })

  it('async apply does not call the host resolve callback', async () => {
    const resolve = vi.fn()
    const result = await applyMappingAsync(
      sources,
      [
        { sourceId: 'rss-title', propertyName: 'title' },
        { propertyName: 'slug', resolve: 'derive' },
        {
          sourceId: 'rss-link',
          propertyName: 'html',
          resolve: 'assemble',
        },
      ],
      targets,
      { resolve },
    )
    expect(resolve).not.toHaveBeenCalled()
    expect(result.errors).toEqual([])
    expect(result.properties).toEqual({ title: 'The grid held, barely' })
  })
})

describe('FieldMapper derive / assemble UI', () => {
  it('offers assemble on Html and labels derive via transformOptions', () => {
    const htmlRow = buildPropertyModeRows({
      targets,
      sources,
      mappings: [{ sourceId: 'rss-link', propertyName: 'html' }],
    }).find((r) => r.id === 'html')!
    expect(defaultTransformOptions(htmlRow).map((o) => o.value)).toContain(
      'assemble',
    )

    const slugRow = buildPropertyModeRows({
      targets,
      sources,
      mappings: [{ propertyName: 'slug', resolve: 'derive' }],
    }).find((r) => r.id === 'slug')!
    expect(defaultTransformOptions(slugRow).some((o) => o.value === 'derive')).toBe(
      true,
    )

    const html = renderToStaticMarkup(
      React.createElement(FieldMapper, {
        sources,
        targets,
        mappings: [
          {
            propertyName: 'slug',
            resolve: 'derive',
            derive: { from: 'title', fallback: true },
          },
          {
            sourceId: 'rss-link',
            propertyName: 'html',
            resolve: 'assemble',
            assemble: { blocks: ['headline', 'body'] },
          },
        ],
        onChange: () => {},
        theme: 'none',
        defaultRows: 'all',
        slots: { preview: 'row', inspector: false, filter: false, autoMap: false },
        transformOptions: (row, defaults) => {
          if (row.id !== 'slug') return defaults
          return [
            ...defaults.filter((opt) => opt.value !== 'derive'),
            { value: 'derive', label: 'from title' },
          ]
        },
        renderRowExpansion: (row) =>
          row.mapping?.resolve === 'assemble'
            ? React.createElement('div', { className: 'host-stack' }, 'AssembleStack')
            : null,
      }),
    )

    expect(html).toContain('from title')
    expect(html).toContain('assemble')
    expect(html).toContain('fm-row-expansion')
    expect(html).toContain('host-stack')
    expect(html).toContain('AssembleStack')
    expect(html).toContain('data-state="mapped"')
    expect(html).toMatch(/data-property-name="slug"[^>]*data-state="mapped"|data-state="mapped"[^>]*data-property-name="slug"/)
  })
})
