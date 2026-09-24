/** Number of cycling pair / map-color slots (`--fm-map-1` … `--fm-map-8`). */
export const FIELD_MAPPER_PAIR_SLOTS = 8

/**
 * Theme modes for FieldMapper.
 * `'unstyled'` is a deprecated alias for `'none'` (kept for one minor).
 */
export type FieldMapperTheme = 'default' | 'structural' | 'none' | 'unstyled'

export type ResolvedFieldMapperTheme = 'default' | 'structural' | 'none'

export const THEME_STYLE_ID = 'seed-field-mapper-theme'

function pairSlot(index: number): number {
  return index % FIELD_MAPPER_PAIR_SLOTS
}

/** Stroke for mapping index `i` — CSS vars by default so hosts can theme. */
export function connectionStrokeForIndex(
  index: number,
  connectionColors?: string[],
): string {
  if (connectionColors && connectionColors.length > 0) {
    return connectionColors[index % connectionColors.length]!
  }
  const n = pairSlot(index) + 1
  return `var(--fm-map-${n}, var(--map-${n}, currentColor))`
}

export { pairSlot }

/** Map public theme prop (including deprecated `unstyled`) to a resolved mode. */
export function resolveTheme(
  theme: FieldMapperTheme = 'default',
): ResolvedFieldMapperTheme {
  if (theme === 'unstyled') return 'none'
  return theme
}

const PAINT_TOKENS = `
  --sfm-color-ground: #0f172a;
  --sfm-color-ink: #e2e8f0;
  --sfm-color-well: #1e293b;
  --sfm-color-line: #334155;
  --sfm-color-muted: #94a3b8;
  --sfm-color-faint: #64748b;
  --sfm-color-selection: #3b82f6;
  --sfm-color-warning: #fbbf24;
  --sfm-color-danger: #f87171;
  --sfm-color-highlight: #f59e0b;
  --sfm-map-1: #3b82f6;
  --sfm-map-2: #8b5cf6;
  --sfm-map-3: #ec4899;
  --sfm-map-4: #f59e0b;
  --sfm-map-5: #10b981;
  --sfm-map-6: #06b6d4;
  --sfm-map-7: #f97316;
  --sfm-map-8: #14b8a6;
  --fm-ground: var(--sfm-color-ground);
  --fm-ink: var(--sfm-color-ink);
  --fm-well: var(--sfm-color-well);
  --fm-line: var(--sfm-color-line);
  --fm-muted: var(--sfm-color-muted);
  --fm-faint: var(--sfm-color-faint);
  --fm-selection: var(--sfm-color-selection);
  --fm-highlight: var(--sfm-color-highlight);
  --fm-danger: var(--sfm-color-danger);
  --fm-warning: var(--sfm-color-warning);
  --fm-map-1: var(--sfm-map-1);
  --fm-map-2: var(--sfm-map-2);
  --fm-map-3: var(--sfm-map-3);
  --fm-map-4: var(--sfm-map-4);
  --fm-map-5: var(--sfm-map-5);
  --fm-map-6: var(--sfm-map-6);
  --fm-map-7: var(--sfm-map-7);
  --fm-map-8: var(--sfm-map-8);
`

const STRUCTURAL_TOKENS = `
  --sfm-space-1: 4px;
  --sfm-space-2: 8px;
  --sfm-space-3: 12px;
  --sfm-space-4: 16px;
  --sfm-radius-sm: 4px;
  --sfm-radius-md: 8px;
  --sfm-radius-lg: 12px;
  --sfm-font-family: inherit;
  --sfm-font-mono: ui-monospace, monospace;
  --sfm-font-size-sm: 11px;
  --sfm-font-size-md: 13px;
  --sfm-control-height: 32px;
  --sfm-row-gap: var(--sfm-space-2);
`

/** Layout / spacing / display rules — no color paint. */
export const STRUCTURAL_THEME_CSS = `
.seed-field-mapper {
${STRUCTURAL_TOKENS}
  font-family: var(--sfm-font-family);
  border-radius: var(--sfm-radius-lg);
  padding: var(--sfm-space-4);
}
.seed-field-mapper * { box-sizing: border-box; }
.seed-field-mapper .fm-toolbar {
  display: flex;
  gap: var(--sfm-space-2);
  align-items: center;
  margin-bottom: var(--sfm-space-3);
  flex-wrap: wrap;
}
.seed-field-mapper .fm-btn {
  border: 1px solid;
  border-radius: var(--sfm-radius-md);
  padding: 6px var(--sfm-space-3);
  cursor: pointer;
  font-size: var(--sfm-font-size-md);
  min-height: var(--sfm-control-height);
}
.seed-field-mapper .fm-meta {
  font-size: 12px;
  margin-left: auto;
}
.seed-field-mapper .fm-banner {
  font-size: 12px;
  padding: var(--sfm-space-2) 10px;
  border-radius: var(--sfm-radius-md);
  margin-bottom: 10px;
  border: 1px solid;
}
.seed-field-mapper .fm-grid {
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 48px;
  min-height: 240px;
}
.seed-field-mapper .fm-col-title {
  font-size: var(--sfm-font-size-sm);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: var(--sfm-space-2);
}
.seed-field-mapper .fm-card {
  border: 1px solid;
  border-radius: var(--sfm-radius-md);
  padding: 10px var(--sfm-space-3);
  margin-bottom: var(--sfm-space-2);
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.seed-field-mapper .fm-label {
  font-weight: 600;
  font-size: var(--sfm-font-size-md);
  margin-bottom: var(--sfm-space-1);
}
.seed-field-mapper .fm-value {
  font-family: var(--sfm-font-mono);
  font-size: var(--sfm-font-size-sm);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.seed-field-mapper .fm-kind {
  font-size: 10px;
  margin-left: 6px;
}
.seed-field-mapper .fm-prop-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sfm-space-2);
}
.seed-field-mapper .fm-dtype {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: var(--sfm-radius-sm);
  border: 1px solid;
}
.seed-field-mapper .fm-remove {
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 14px;
  padding: 0 var(--sfm-space-1);
}
.seed-field-mapper .fm-svg {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: visible;
}
.seed-field-mapper .fm-preview {
  margin-top: var(--sfm-space-3);
  border: 1px solid;
  border-radius: var(--sfm-radius-md);
  padding: var(--sfm-space-3);
  font-family: var(--sfm-font-mono);
  font-size: var(--sfm-font-size-sm);
  white-space: pre-wrap;
  max-height: 200px;
  overflow: auto;
}
.seed-field-mapper details.fm-preview {
  font-family: var(--sfm-font-family);
  white-space: normal;
  max-height: none;
  overflow: visible;
  padding: var(--sfm-space-2) var(--sfm-space-3);
}
.seed-field-mapper details.fm-preview > summary {
  cursor: pointer;
  font-size: var(--sfm-font-size-sm);
  list-style: disclosure-closed;
}
.seed-field-mapper details.fm-preview[open] > summary {
  list-style: disclosure-open;
  margin-bottom: var(--sfm-space-2);
}
.seed-field-mapper .fm-preview-body {
  margin: 0;
  font-family: var(--sfm-font-mono);
  font-size: var(--sfm-font-size-sm);
  white-space: pre-wrap;
  max-height: 200px;
  overflow: auto;
}
.seed-field-mapper .fm-lookups {
  margin-top: var(--sfm-space-4);
  border-top: 1px solid;
  padding-top: var(--sfm-space-3);
}
.seed-field-mapper .fm-row .fm-lookups,
.seed-field-mapper .fm-lookups--row {
  margin-top: var(--sfm-space-2);
  border-top: none;
  padding-top: 0;
}
.seed-field-mapper .fm-row .fm-lookup-block {
  margin-bottom: 0;
  padding: var(--sfm-space-2);
}
.seed-field-mapper .fm-lookups-title {
  font-size: var(--sfm-font-size-sm);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: var(--sfm-space-2);
}
.seed-field-mapper .fm-lookup-block {
  border: 1px solid;
  border-radius: var(--sfm-radius-md);
  padding: 10px var(--sfm-space-3);
  margin-bottom: var(--sfm-space-2);
}
.seed-field-mapper .fm-lookup-block h4 {
  margin: 0 0 var(--sfm-space-2);
  font-size: var(--sfm-font-size-md);
  font-weight: 600;
}
.seed-field-mapper .fm-lookup-hint {
  font-size: var(--sfm-font-size-sm);
  margin-bottom: var(--sfm-space-2);
}
.seed-field-mapper .fm-lookup-row {
  display: grid;
  grid-template-columns: 1fr 1.4fr;
  gap: var(--sfm-space-2);
  align-items: center;
  margin-bottom: 6px;
}
.seed-field-mapper .fm-lookup-key {
  font-family: var(--sfm-font-mono);
  font-size: var(--sfm-font-size-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.seed-field-mapper .fm-lookup-input {
  width: 100%;
  border: 1px solid;
  border-radius: 6px;
  font-family: var(--sfm-font-mono);
  font-size: var(--sfm-font-size-sm);
  padding: 6px var(--sfm-space-2);
}
.seed-field-mapper .fm-lookup-input:focus {
  outline: none;
}
.seed-field-mapper .fm-row-list {
  display: flex;
  flex-direction: column;
  gap: var(--sfm-row-gap);
}
.seed-field-mapper .fm-row {
  border: 1px solid;
  border-radius: var(--sfm-radius-md);
  padding: 10px var(--sfm-space-3);
}
.seed-field-mapper .fm-row-main {
  display: grid;
  grid-template-columns: minmax(100px, 140px) 1fr auto auto auto;
  gap: var(--sfm-space-2);
  align-items: center;
}
.seed-field-mapper .fm-row-main-source {
  grid-template-columns: 1fr auto auto 1fr auto auto;
}
.seed-field-mapper .fm-row-accessory {
  display: flex;
  align-items: center;
  min-width: 0;
}
.seed-field-mapper .fm-row-accessory:empty {
  display: none;
}
.seed-field-mapper .fm-row-prop {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.seed-field-mapper .fm-row-prop-name {
  font-weight: 600;
  font-size: var(--sfm-font-size-md);
}
.seed-field-mapper .fm-row-preview {
  margin-top: 6px;
  font-family: var(--sfm-font-mono);
  font-size: var(--sfm-font-size-sm);
}
.seed-field-mapper .fm-row-expansion {
  margin-top: 8px;
}
.seed-field-mapper .fm-row-expansion:empty {
  display: none;
}
.seed-field-mapper .fm-row-flag {
  font-size: var(--sfm-font-size-sm);
  margin-top: var(--sfm-space-1);
}
.seed-field-mapper .fm-select {
  width: 100%;
  border: 1px solid;
  border-radius: 6px;
  font-size: 12px;
  padding: 6px var(--sfm-space-2);
  min-width: 0;
  min-height: var(--sfm-control-height);
}
.seed-field-mapper .fm-select:focus {
  outline: none;
}
.seed-field-mapper .fm-filter {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.seed-field-mapper .fm-inspector {
  margin-top: var(--sfm-space-3);
  border-top: 1px solid;
  padding-top: 10px;
}
.seed-field-mapper .fm-inspector summary {
  cursor: pointer;
  font-size: 12px;
  margin-bottom: var(--sfm-space-2);
}
.seed-field-mapper .fm-inspector-row {
  display: grid;
  grid-template-columns: 1fr 1.5fr auto;
  gap: var(--sfm-space-2);
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid;
  font-size: 12px;
}
.seed-field-mapper .fm-into {
  font-size: var(--sfm-font-size-sm);
}
`

/** Color / background / border-color paint on top of structural layout. */
export const PAINT_THEME_CSS = `
.seed-field-mapper {
${PAINT_TOKENS}
  color: var(--sfm-color-ink);
  background: var(--sfm-color-ground);
}
.seed-field-mapper .fm-btn {
  background: var(--sfm-color-well);
  border-color: var(--sfm-color-line);
  color: var(--sfm-color-ink);
}
.seed-field-mapper .fm-btn:hover { border-color: var(--sfm-color-faint); }
.seed-field-mapper .fm-btn-primary {
  background: var(--sfm-color-selection);
  border-color: var(--sfm-color-selection);
}
.seed-field-mapper .fm-meta {
  color: var(--sfm-color-muted);
}
.seed-field-mapper .fm-banner {
  border-color: var(--sfm-color-line);
  background: var(--sfm-color-well);
}
.seed-field-mapper .fm-banner-warn {
  border-color: var(--sfm-color-warning);
  color: var(--sfm-color-warning);
}
.seed-field-mapper .fm-banner-danger {
  border-color: var(--sfm-color-danger);
  color: var(--sfm-color-danger);
}
.seed-field-mapper .fm-col-title {
  color: var(--sfm-color-faint);
}
.seed-field-mapper .fm-card {
  border-color: var(--sfm-color-line);
  background: var(--sfm-color-well);
}
.seed-field-mapper .fm-card.active,
.seed-field-mapper .fm-card.pending {
  border-color: var(--sfm-color-selection);
  box-shadow: 0 0 0 1px var(--sfm-color-selection);
}
.seed-field-mapper .fm-card.mapped {
  border-color: var(--sfm-color-faint);
}
.seed-field-mapper .fm-card.highlight {
  border-color: var(--sfm-color-highlight);
}
.seed-field-mapper .fm-value {
  color: var(--sfm-color-muted);
}
.seed-field-mapper .fm-kind {
  color: var(--sfm-color-faint);
}
.seed-field-mapper .fm-dtype {
  border-color: var(--sfm-color-line);
  color: var(--sfm-color-muted);
  background: transparent;
}
.seed-field-mapper .fm-remove {
  color: var(--sfm-color-muted);
}
.seed-field-mapper .fm-remove:hover { color: var(--sfm-color-danger); }
.seed-field-mapper .fm-preview {
  background: color-mix(in srgb, var(--sfm-color-ground) 80%, black);
  border-color: var(--sfm-color-line);
  color: var(--sfm-color-ink);
}
.seed-field-mapper details.fm-preview > summary {
  color: var(--sfm-color-muted);
}
.seed-field-mapper .fm-lookups {
  border-color: var(--sfm-color-line);
}
.seed-field-mapper .fm-lookups-title {
  color: var(--sfm-color-faint);
}
.seed-field-mapper .fm-lookup-block {
  border-color: var(--sfm-color-line);
  background: var(--sfm-color-well);
}
.seed-field-mapper .fm-lookup-hint {
  color: var(--sfm-color-muted);
}
.seed-field-mapper .fm-lookup-key {
  color: var(--sfm-color-muted);
}
.seed-field-mapper .fm-lookup-input {
  background: var(--sfm-color-ground);
  border-color: var(--sfm-color-line);
  color: var(--sfm-color-ink);
}
.seed-field-mapper .fm-lookup-input:focus {
  border-color: var(--sfm-color-selection);
}
.seed-field-mapper .fm-row {
  border-color: var(--sfm-color-line);
  background: var(--sfm-color-well);
}
.seed-field-mapper .fm-row[data-state="needsResolve"] {
  border-color: var(--sfm-color-warning);
}
.seed-field-mapper .fm-row[data-state="conflict"] {
  border-color: var(--sfm-color-danger);
}
.seed-field-mapper .fm-row-preview {
  color: var(--sfm-color-muted);
}
.seed-field-mapper .fm-row-flag {
  color: var(--sfm-color-warning);
}
.seed-field-mapper .fm-select {
  background: var(--sfm-color-ground);
  border-color: var(--sfm-color-line);
  color: var(--sfm-color-ink);
}
.seed-field-mapper .fm-select:focus {
  border-color: var(--sfm-color-selection);
}
.seed-field-mapper .fm-filter .fm-btn[aria-pressed="true"] {
  border-color: var(--sfm-color-selection);
  color: var(--sfm-color-ink);
}
.seed-field-mapper .fm-inspector {
  border-color: var(--sfm-color-line);
}
.seed-field-mapper .fm-inspector summary {
  color: var(--sfm-color-muted);
}
.seed-field-mapper .fm-inspector-row {
  border-color: var(--sfm-color-line);
}
.seed-field-mapper .fm-into {
  color: var(--sfm-color-faint);
}
`

/** Wrap CSS in the package cascade layer so host rules win without specificity fights. */
export function wrapInThemeLayer(css: string): string {
  return `@layer seed-field-mapper {\n${css}\n}`
}

/** Build the CSS string for a resolved theme mode (`none` → empty). */
export function buildThemeCss(theme: ResolvedFieldMapperTheme): string {
  if (theme === 'none') return ''
  if (theme === 'structural') {
    return wrapInThemeLayer(STRUCTURAL_THEME_CSS)
  }
  return wrapInThemeLayer(`${STRUCTURAL_THEME_CSS}\n${PAINT_THEME_CSS}`)
}

/** Full default theme CSS (structural + paint, layered). Exported for tests / hosts. */
export const DEFAULT_THEME_CSS = buildThemeCss('default')

let injectedTheme: ResolvedFieldMapperTheme | null = null

/**
 * Inject theme CSS once into `document.head`. Updates the existing style node
 * when the resolved theme changes. No-op when `document` is unavailable (SSR)
 * or when `theme === 'none'`.
 */
export function ensureThemeInjected(theme: ResolvedFieldMapperTheme): void {
  if (typeof document === 'undefined') return
  if (theme === 'none') return

  const css = buildThemeCss(theme)
  const existing = document.getElementById(
    THEME_STYLE_ID,
  ) as HTMLStyleElement | null

  if (existing) {
    if (injectedTheme !== theme) {
      existing.textContent = css
      injectedTheme = theme
    }
    return
  }

  const el = document.createElement('style')
  el.id = THEME_STYLE_ID
  el.textContent = css
  document.head.appendChild(el)
  injectedTheme = theme
}

/** Test helper: reset document-once injection bookkeeping. */
export function resetThemeInjectionForTests(): void {
  injectedTheme = null
  if (typeof document === 'undefined') return
  const el = document.getElementById(THEME_STYLE_ID)
  if (!el) return
  if (typeof el.remove === 'function') {
    el.remove()
  } else if (el.parentNode) {
    el.parentNode.removeChild(el)
  }
}
