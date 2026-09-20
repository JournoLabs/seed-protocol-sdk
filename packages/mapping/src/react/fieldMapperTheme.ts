/** Number of cycling pair / map-color slots (`--fm-map-1` … `--fm-map-8`). */
export const FIELD_MAPPER_PAIR_SLOTS = 8

export type FieldMapperTheme = 'default' | 'unstyled'

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

export const DEFAULT_THEME_CSS = `
.seed-field-mapper {
  --fm-ground: #0f172a;
  --fm-ink: #e2e8f0;
  --fm-well: #1e293b;
  --fm-line: #334155;
  --fm-muted: #94a3b8;
  --fm-faint: #64748b;
  --fm-selection: #3b82f6;
  --fm-highlight: #f59e0b;
  --fm-danger: #f87171;
  --fm-warning: #fbbf24;
  --fm-map-1: #3b82f6;
  --fm-map-2: #8b5cf6;
  --fm-map-3: #ec4899;
  --fm-map-4: #f59e0b;
  --fm-map-5: #10b981;
  --fm-map-6: #06b6d4;
  --fm-map-7: #f97316;
  --fm-map-8: #14b8a6;
  font-family: 'DM Sans', system-ui, sans-serif;
  color: var(--fm-ink);
  background: var(--fm-ground);
  border-radius: 12px;
  padding: 16px;
}
.seed-field-mapper * { box-sizing: border-box; }
.seed-field-mapper .fm-toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.seed-field-mapper .fm-btn {
  background: var(--fm-well);
  border: 1px solid var(--fm-line);
  color: var(--fm-ink);
  border-radius: 8px;
  padding: 6px 12px;
  cursor: pointer;
  font-size: 13px;
}
.seed-field-mapper .fm-btn:hover { border-color: var(--fm-faint); }
.seed-field-mapper .fm-btn-primary {
  background: var(--fm-selection);
  border-color: var(--fm-selection);
}
.seed-field-mapper .fm-meta {
  font-size: 12px;
  color: var(--fm-muted);
  margin-left: auto;
}
.seed-field-mapper .fm-banner {
  font-size: 12px;
  padding: 8px 10px;
  border-radius: 8px;
  margin-bottom: 10px;
  border: 1px solid var(--fm-line);
  background: var(--fm-well);
}
.seed-field-mapper .fm-banner-warn {
  border-color: var(--fm-warning);
  color: var(--fm-warning);
}
.seed-field-mapper .fm-banner-danger {
  border-color: var(--fm-danger);
  color: var(--fm-danger);
}
.seed-field-mapper .fm-grid {
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 48px;
  min-height: 240px;
}
.seed-field-mapper .fm-col-title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--fm-faint);
  margin-bottom: 8px;
}
.seed-field-mapper .fm-card {
  border: 1px solid var(--fm-line);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 8px;
  background: var(--fm-well);
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.seed-field-mapper .fm-card.active,
.seed-field-mapper .fm-card.pending {
  border-color: var(--fm-selection);
  box-shadow: 0 0 0 1px var(--fm-selection);
}
.seed-field-mapper .fm-card.mapped {
  border-color: var(--fm-faint);
}
.seed-field-mapper .fm-card.highlight {
  border-color: var(--fm-highlight);
}
.seed-field-mapper .fm-label {
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 4px;
}
.seed-field-mapper .fm-value {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  color: var(--fm-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.seed-field-mapper .fm-kind {
  font-size: 10px;
  color: var(--fm-faint);
  margin-left: 6px;
}
.seed-field-mapper .fm-prop-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.seed-field-mapper .fm-dtype {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid var(--fm-line);
  color: var(--fm-muted);
  background: transparent;
}
.seed-field-mapper .fm-remove {
  background: transparent;
  border: none;
  color: var(--fm-muted);
  cursor: pointer;
  font-size: 14px;
  padding: 0 4px;
}
.seed-field-mapper .fm-remove:hover { color: var(--fm-danger); }
.seed-field-mapper .fm-svg {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: visible;
}
.seed-field-mapper .fm-preview {
  margin-top: 12px;
  background: color-mix(in srgb, var(--fm-ground) 80%, black);
  border: 1px solid var(--fm-line);
  border-radius: 8px;
  padding: 12px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  white-space: pre-wrap;
  color: var(--fm-ink);
  max-height: 200px;
  overflow: auto;
}
.seed-field-mapper .fm-lookups {
  margin-top: 16px;
  border-top: 1px solid var(--fm-line);
  padding-top: 12px;
}
.seed-field-mapper .fm-lookups-title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--fm-faint);
  margin-bottom: 8px;
}
.seed-field-mapper .fm-lookup-block {
  border: 1px solid var(--fm-line);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 8px;
  background: var(--fm-well);
}
.seed-field-mapper .fm-lookup-block h4 {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
}
.seed-field-mapper .fm-lookup-hint {
  font-size: 11px;
  color: var(--fm-muted);
  margin-bottom: 8px;
}
.seed-field-mapper .fm-lookup-row {
  display: grid;
  grid-template-columns: 1fr 1.4fr;
  gap: 8px;
  align-items: center;
  margin-bottom: 6px;
}
.seed-field-mapper .fm-lookup-key {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  color: var(--fm-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.seed-field-mapper .fm-lookup-input {
  width: 100%;
  background: var(--fm-ground);
  border: 1px solid var(--fm-line);
  border-radius: 6px;
  color: var(--fm-ink);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  padding: 6px 8px;
}
.seed-field-mapper .fm-lookup-input:focus {
  outline: none;
  border-color: var(--fm-selection);
}
.seed-field-mapper .fm-row-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.seed-field-mapper .fm-row {
  border: 1px solid var(--fm-line);
  border-radius: 8px;
  padding: 10px 12px;
  background: var(--fm-well);
}
.seed-field-mapper .fm-row[data-state="needsResolve"] {
  border-color: var(--fm-warning);
}
.seed-field-mapper .fm-row[data-state="conflict"] {
  border-color: var(--fm-danger);
}
.seed-field-mapper .fm-row-main {
  display: grid;
  grid-template-columns: minmax(100px, 140px) 1fr auto auto auto;
  gap: 8px;
  align-items: center;
}
.seed-field-mapper .fm-row-main-source {
  grid-template-columns: 1fr auto auto 1fr auto;
}
.seed-field-mapper .fm-row-prop {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.seed-field-mapper .fm-row-prop-name {
  font-weight: 600;
  font-size: 13px;
}
.seed-field-mapper .fm-row-preview {
  margin-top: 6px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  color: var(--fm-muted);
}
.seed-field-mapper .fm-row-flag {
  font-size: 11px;
  color: var(--fm-warning);
  margin-top: 4px;
}
.seed-field-mapper .fm-select {
  width: 100%;
  background: var(--fm-ground);
  border: 1px solid var(--fm-line);
  border-radius: 6px;
  color: var(--fm-ink);
  font-size: 12px;
  padding: 6px 8px;
  min-width: 0;
}
.seed-field-mapper .fm-select:focus {
  outline: none;
  border-color: var(--fm-selection);
}
.seed-field-mapper .fm-filter {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.seed-field-mapper .fm-filter .fm-btn[aria-pressed="true"] {
  border-color: var(--fm-selection);
  color: var(--fm-ink);
}
.seed-field-mapper .fm-inspector {
  margin-top: 12px;
  border-top: 1px solid var(--fm-line);
  padding-top: 10px;
}
.seed-field-mapper .fm-inspector summary {
  cursor: pointer;
  font-size: 12px;
  color: var(--fm-muted);
  margin-bottom: 8px;
}
.seed-field-mapper .fm-inspector-row {
  display: grid;
  grid-template-columns: 1fr 1.5fr auto;
  gap: 8px;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid var(--fm-line);
  font-size: 12px;
}
.seed-field-mapper .fm-into {
  font-size: 11px;
  color: var(--fm-faint);
}
`
