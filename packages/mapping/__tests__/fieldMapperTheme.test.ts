import { afterEach, describe, expect, it } from 'vitest'
import {
  FIELD_MAPPER_PAIR_SLOTS,
  PAINT_THEME_CSS,
  STRUCTURAL_THEME_CSS,
  THEME_STYLE_ID,
  buildThemeCss,
  connectionStrokeForIndex,
  ensureThemeInjected,
  resetThemeInjectionForTests,
  resolveSlots,
  resolveTheme,
  showJsonPreview,
  showRowPreview,
  slotClass,
  wrapInThemeLayer,
} from '../src/react/FieldMapper'

describe('connectionStrokeForIndex', () => {
  it('uses host connectionColors when provided', () => {
    expect(connectionStrokeForIndex(0, ['#aaa', '#bbb'])).toBe('#aaa')
    expect(connectionStrokeForIndex(1, ['#aaa', '#bbb'])).toBe('#bbb')
    expect(connectionStrokeForIndex(2, ['#aaa', '#bbb'])).toBe('#aaa')
  })

  it('defaults to CSS vars --fm-map-N with --map-N fallback', () => {
    expect(connectionStrokeForIndex(0)).toBe(
      'var(--fm-map-1, var(--map-1, currentColor))',
    )
    expect(connectionStrokeForIndex(7)).toBe(
      'var(--fm-map-8, var(--map-8, currentColor))',
    )
    expect(connectionStrokeForIndex(8)).toBe(
      'var(--fm-map-1, var(--map-1, currentColor))',
    )
  })

  it('exposes eight pair slots', () => {
    expect(FIELD_MAPPER_PAIR_SLOTS).toBe(8)
  })
})

describe('resolveTheme', () => {
  it('maps unstyled to none', () => {
    expect(resolveTheme('unstyled')).toBe('none')
  })

  it('passes through default, structural, and none', () => {
    expect(resolveTheme('default')).toBe('default')
    expect(resolveTheme('structural')).toBe('structural')
    expect(resolveTheme('none')).toBe('none')
    expect(resolveTheme()).toBe('default')
  })
})

describe('theme CSS tokens and layer', () => {
  it('wraps CSS in @layer seed-field-mapper', () => {
    expect(wrapInThemeLayer('.x{}')).toContain('@layer seed-field-mapper')
    expect(buildThemeCss('default')).toMatch(/^@layer seed-field-mapper/)
    expect(buildThemeCss('structural')).toMatch(/^@layer seed-field-mapper/)
  })

  it('includes --sfm-* tokens and --fm-* aliases in paint CSS', () => {
    expect(PAINT_THEME_CSS).toContain('--sfm-color-ground:')
    expect(PAINT_THEME_CSS).toContain('--sfm-color-ink:')
    expect(PAINT_THEME_CSS).toContain('--fm-ground: var(--sfm-color-ground)')
    expect(PAINT_THEME_CSS).toContain('--fm-ink: var(--sfm-color-ink)')
    expect(PAINT_THEME_CSS).toContain('--sfm-map-1:')
    expect(PAINT_THEME_CSS).toContain('--fm-map-1: var(--sfm-map-1)')
  })

  it('defaults --sfm-font-family to inherit in structural CSS', () => {
    expect(STRUCTURAL_THEME_CSS).toContain('--sfm-font-family: inherit')
    expect(STRUCTURAL_THEME_CSS).not.toContain('DM Sans')
    expect(STRUCTURAL_THEME_CSS).not.toContain('JetBrains Mono')
  })

  it('includes spacing / radius / control tokens', () => {
    expect(STRUCTURAL_THEME_CSS).toContain('--sfm-space-1:')
    expect(STRUCTURAL_THEME_CSS).toContain('--sfm-radius-md:')
    expect(STRUCTURAL_THEME_CSS).toContain('--sfm-control-height:')
    expect(STRUCTURAL_THEME_CSS).toContain('--sfm-row-gap:')
  })

  it('builds CSS by theme mode', () => {
    expect(buildThemeCss('none')).toBe('')
    const structural = buildThemeCss('structural')
    expect(structural).toContain('--sfm-font-family: inherit')
    expect(structural).not.toContain('--sfm-color-ground:')
    const full = buildThemeCss('default')
    expect(full).toContain('--sfm-font-family: inherit')
    expect(full).toContain('--sfm-color-ground:')
  })
})

describe('ensureThemeInjected (document-once)', () => {
  afterEach(() => {
    resetThemeInjectionForTests()
  })

  it('injects a single style node and does not duplicate on second call', () => {
    const g = globalThis as typeof globalThis & {
      document?: {
        getElementById: (id: string) => HTMLElement | null
        createElement: (tag: string) => HTMLElement
        head: { appendChild: (el: HTMLElement) => void; children: HTMLElement[] }
      }
    }

    const nodes = new Map<
      string,
      { id: string; textContent: string | null; remove: () => void }
    >()
    const headChildren: {
      id: string
      textContent: string | null
      remove: () => void
    }[] = []

    g.document = {
      getElementById(id: string) {
        return (nodes.get(id) as unknown as HTMLElement) ?? null
      },
      createElement(tag: string) {
        if (tag !== 'style') throw new Error(`unexpected tag ${tag}`)
        const el = {
          id: '',
          textContent: null as string | null,
          remove() {
            nodes.delete(el.id)
            const idx = headChildren.indexOf(el)
            if (idx >= 0) headChildren.splice(idx, 1)
          },
        }
        return el as unknown as HTMLElement
      },
      head: {
        children: headChildren as unknown as HTMLElement[],
        appendChild(el: HTMLElement) {
          const node = el as unknown as {
            id: string
            textContent: string | null
            remove: () => void
          }
          nodes.set(node.id, node)
          headChildren.push(node)
        },
      },
    }

    ensureThemeInjected('default')
    ensureThemeInjected('default')
    expect(headChildren).toHaveLength(1)
    expect(headChildren[0]!.id).toBe(THEME_STYLE_ID)
    expect(headChildren[0]!.textContent).toContain('@layer seed-field-mapper')
    expect(headChildren[0]!.textContent).toContain('--sfm-color-ground:')

    ensureThemeInjected('structural')
    expect(headChildren).toHaveLength(1)
    expect(headChildren[0]!.textContent).not.toContain('--sfm-color-ground:')
    expect(headChildren[0]!.textContent).toContain('--sfm-font-family: inherit')

    ensureThemeInjected('none')
    expect(headChildren).toHaveLength(1)

    delete g.document
  })
})

describe('slotClass', () => {
  it('merges package and host classes', () => {
    expect(slotClass('row')).toBe('fm-row')
    expect(slotClass('row', { row: 'host-row' })).toBe('fm-row host-row')
    expect(slotClass('toolbar', { toolbar: 't' }, 'extra')).toBe(
      'fm-toolbar t extra',
    )
  })
})

describe('resolveSlots shims', () => {
  it('defaults to both preview modes and enabled chrome', () => {
    expect(resolveSlots()).toEqual({
      autoMap: true,
      filter: true,
      inspector: true,
      preview: 'both',
      lookups: 'section',
    })
  })

  it('maps showPreview: false to slots.preview false', () => {
    expect(resolveSlots(undefined, false).preview).toBe(false)
    expect(showJsonPreview(false)).toBe(false)
    expect(showRowPreview(false)).toBe(false)
  })

  it('prefers slots.preview over showPreview', () => {
    expect(resolveSlots({ preview: 'row' }, false).preview).toBe('row')
    expect(showRowPreview('row')).toBe(true)
    expect(showJsonPreview('row')).toBe(false)
  })

  it('falls back lookups row to section until Phase 4', () => {
    expect(resolveSlots({ lookups: 'row' }).lookups).toBe('section')
    expect(resolveSlots({ lookups: false }).lookups).toBe(false)
  })
})
