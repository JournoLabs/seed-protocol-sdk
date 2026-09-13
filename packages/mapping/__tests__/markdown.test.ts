import { describe, expect, it } from 'vitest'
import {
  markdownToSources,
  parseMarkdownWithFrontmatter,
  SECTION_FULL_ID,
} from '../src/adapters/markdown'

const SAMPLE = `---
title: Hello World
draft: true
tags: [a, b]
---
# Intro

Some intro text.

## Details

More details here.
`

describe('parseMarkdownWithFrontmatter', () => {
  it('parses flat frontmatter and body', () => {
    const parsed = parseMarkdownWithFrontmatter(SAMPLE)
    expect(parsed.frontmatter.map((f) => f.key)).toEqual([
      'title',
      'draft',
      'tags',
    ])
    expect(parsed.frontmatter.find((f) => f.key === 'draft')?.valueType).toBe(
      'boolean',
    )
    expect(parsed.body).toContain('# Intro')
  })

  it('returns full content as body when no frontmatter', () => {
    const parsed = parseMarkdownWithFrontmatter('# Only\n\ntext')
    expect(parsed.frontmatter).toEqual([])
    expect(parsed.body).toBe('# Only\n\ntext')
  })
})

describe('markdownToSources', () => {
  it('emits frontmatter, full doc, and H1/H2 sections', () => {
    const sources = markdownToSources(SAMPLE)
    expect(sources.some((s) => s.id === 'fm-title')).toBe(true)
    expect(sources.find((s) => s.id === SECTION_FULL_ID)?.kind).toBe('full')
    const sections = sources.filter((s) => s.kind === 'section')
    expect(sections.map((s) => s.label)).toEqual(['Intro', 'Details'])
    expect(sections[0]?.value).toContain('Some intro text')
  })
})
