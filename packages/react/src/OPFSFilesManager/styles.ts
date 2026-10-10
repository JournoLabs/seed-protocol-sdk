/**
 * Scoped stylesheet for OPFSFilesManager. Injected once into document.head (see
 * docs/adr/0002-component-styling-tokens-and-injected-css.md). Every color comes from a
 * `--seed-*` custom property, so hosts restyle by overriding variables on `.seed-fm`
 * or an ancestor.
 */

export const STYLE_ELEMENT_ID = 'seed-opfs-files-manager-styles'
export const STYLE_LAYER = 'seed-opfs-files-manager'

const LIGHT_TOKENS = `
  --seed-bg: #fbfcfb;
  --seed-surface: #ffffff;
  --seed-sunken: #f0f3f1;
  --seed-hover: #e9eeeb;
  --seed-fg: #18211d;
  --seed-fg-muted: #5a6861;
  --seed-fg-faint: #8a978f;
  --seed-border: #dfe5e1;
  --seed-border-strong: #c5cfc9;
  --seed-accent: #2c6b59;
  --seed-accent-fg: #ffffff;
  --seed-accent-soft: #e0eee8;
  --seed-danger: #b4332a;
  --seed-danger-fg: #ffffff;
  --seed-danger-soft: #fbe7e4;
  --seed-danger-inverse: #ff9a8f;
  --seed-warn: #8a5208;
  --seed-warn-soft: #fdf1dc;
  --seed-kind-image: #2f7d68;
  --seed-kind-database: #6a4fb3;
  --seed-kind-json: #a2620e;
  --seed-kind-html: #b0413a;
  --seed-kind-text: #3f6f9a;
  --seed-kind-other: #66736c;
  --seed-checker-a: #eef1ef;
  --seed-checker-b: #ffffff;
  --seed-shadow: 0 10px 30px rgb(16 24 20 / 0.14), 0 2px 6px rgb(16 24 20 / 0.08);
  --seed-backdrop: rgb(8 12 10 / 0.42);
`

const DARK_TOKENS = `
  --seed-bg: #111816;
  --seed-surface: #171f1c;
  --seed-sunken: #1d2723;
  --seed-hover: #24302b;
  --seed-fg: #e4ebe7;
  --seed-fg-muted: #9daba3;
  --seed-fg-faint: #6f7d76;
  --seed-border: #29342f;
  --seed-border-strong: #3a4842;
  --seed-accent: #6cc0a3;
  --seed-accent-fg: #0c1a15;
  --seed-accent-soft: #1c3a30;
  --seed-danger: #f08277;
  --seed-danger-fg: #2a0d0a;
  --seed-danger-soft: #3b1c19;
  --seed-danger-inverse: #b4332a;
  --seed-warn: #e9b062;
  --seed-warn-soft: #382a14;
  --seed-kind-image: #6cc0a3;
  --seed-kind-database: #b29cf0;
  --seed-kind-json: #e3ad5c;
  --seed-kind-html: #ef8a80;
  --seed-kind-text: #8fb8de;
  --seed-kind-other: #9aa8a0;
  --seed-checker-a: #1d2723;
  --seed-checker-b: #24302b;
  --seed-shadow: 0 12px 34px rgb(0 0 0 / 0.5), 0 2px 6px rgb(0 0 0 / 0.4);
  --seed-backdrop: rgb(0 0 0 / 0.55);
  color-scheme: dark;
`

const CHECKER = `background-color: var(--seed-checker-b);
  background-image: conic-gradient(var(--seed-checker-a) 25%, transparent 0 50%, var(--seed-checker-a) 0 75%, transparent 0);`

const CSS = `
.seed-fm {
  ${LIGHT_TOKENS}
  --seed-radius-sm: 6px;
  --seed-radius-md: 8px;
  --seed-radius-lg: 12px;
  --seed-font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color-scheme: light;
}
.seed-fm[data-seed-theme="dark"] { ${DARK_TOKENS} }
@media (prefers-color-scheme: dark) {
  .seed-fm[data-seed-theme="system"] { ${DARK_TOKENS} }
}

.seed-fm { position: relative; color: var(--seed-fg); background: var(--seed-bg); font-family: inherit; font-size: 14px; line-height: 1.45; }
.seed-fm *, .seed-fm *::before, .seed-fm *::after { box-sizing: border-box; }
/* Element defaults use :where() so they have zero specificity and any component class beats them. */
:where(.seed-fm) :where(button, input, select) { font: inherit; color: inherit; }
.seed-fm :focus-visible { outline: 2px solid var(--seed-accent); outline-offset: 2px; }
:where(.seed-fm) :where(svg) { flex: none; display: inline-block; vertical-align: middle; }
.seed-fm-frame { container: seed-fm / inline-size; }

.seed-fm-header { display: flex; flex-wrap: wrap; gap: 12px 20px; align-items: flex-start; padding: 18px 20px 14px; }
.seed-fm-titles { flex: 1 1 240px; min-width: 0; }
.seed-fm-title { font-size: 20px; line-height: 1.25; font-weight: 600; margin: 0; letter-spacing: -0.01em; }
.seed-fm-description { margin: 2px 0 0; color: var(--seed-fg-muted); font-size: 13px; }
.seed-fm-usage { flex: 0 1 280px; min-width: 200px; font-size: 12px; color: var(--seed-fg-muted); }
.seed-fm-usage-row { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 5px; font-variant-numeric: tabular-nums; }
.seed-fm-usage-row strong { color: var(--seed-fg); font-weight: 600; }
.seed-fm-meter { height: 6px; border-radius: 99px; background: var(--seed-sunken); overflow: hidden; display: flex; }
.seed-fm-meter > span { display: block; height: 100%; }
.seed-fm-legend { display: flex; flex-wrap: wrap; gap: 4px 10px; margin: 6px 0 0; padding: 0; list-style: none; }
.seed-fm-legend li { display: inline-flex; align-items: center; gap: 5px; font-variant-numeric: tabular-nums; }
.seed-fm-legend li::before { content: ""; width: 7px; height: 7px; border-radius: 2px; background: var(--seed-swatch); }

.seed-fm-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; padding: 0 12px; margin: 0; border-radius: var(--seed-radius-md); border: 1px solid var(--seed-border); background: var(--seed-surface); color: var(--seed-fg); cursor: pointer; font-size: 13px; font-weight: 500; white-space: nowrap; text-decoration: none; }
.seed-fm-btn:hover:not(:disabled) { background: var(--seed-hover); }
.seed-fm-btn:disabled { opacity: 0.45; cursor: default; }
.seed-fm-btn--icon { width: 32px; padding: 0; }
.seed-fm-btn--primary { background: var(--seed-accent); border-color: var(--seed-accent); color: var(--seed-accent-fg); }
.seed-fm-btn--primary:hover:not(:disabled) { background: var(--seed-accent); filter: brightness(1.08); }
.seed-fm-btn--danger { background: var(--seed-danger); border-color: var(--seed-danger); color: var(--seed-danger-fg); }
.seed-fm-btn--danger:hover:not(:disabled) { background: var(--seed-danger); filter: brightness(1.08); }
.seed-fm-btn--ghost { border-color: transparent; background: transparent; }
.seed-fm-btn--danger-text { color: var(--seed-danger); }
.seed-fm-btn[data-busy="true"] svg { animation: seed-fm-spin 0.8s linear infinite; }
@keyframes seed-fm-spin { to { transform: rotate(360deg); } }

.seed-fm-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; padding: 0 20px 12px; border-bottom: 1px solid var(--seed-border); }
.seed-fm-crumbs { display: flex; align-items: center; gap: 2px; min-width: 0; flex: 1 1 auto; font-size: 13px; overflow: hidden; margin: 0; padding: 0; list-style: none; }
.seed-fm-crumbs li { display: inline-flex; align-items: center; min-width: 0; }
.seed-fm-crumbs button { border: 0; background: none; padding: 4px 6px; border-radius: var(--seed-radius-sm); cursor: pointer; color: var(--seed-fg-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 24ch; }
.seed-fm-crumbs button:hover { background: var(--seed-hover); color: var(--seed-fg); }
.seed-fm-crumbs button[aria-current="page"] { color: var(--seed-fg); font-weight: 600; }
.seed-fm-crumbs svg { color: var(--seed-fg-faint); }
.seed-fm-search { position: relative; flex: 0 1 220px; min-width: 140px; display: block; }
.seed-fm-search svg { position: absolute; left: 9px; top: 50%; transform: translateY(-50%); color: var(--seed-fg-faint); pointer-events: none; }
.seed-fm-search input { width: 100%; height: 32px; margin: 0; padding: 0 10px 0 30px; border-radius: var(--seed-radius-md); border: 1px solid var(--seed-border); background: var(--seed-surface); color: var(--seed-fg); font-size: 13px; }
.seed-fm-search input::placeholder { color: var(--seed-fg-faint); }
.seed-fm-select { height: 32px; margin: 0; border-radius: var(--seed-radius-md); border: 1px solid var(--seed-border); background: var(--seed-surface); color: var(--seed-fg); font-size: 13px; padding: 0 8px; }
.seed-fm-viewtoggle { display: inline-flex; border: 1px solid var(--seed-border); border-radius: var(--seed-radius-md); overflow: hidden; }
.seed-fm-viewtoggle button { width: 32px; height: 30px; margin: 0; border: 0; background: var(--seed-surface); cursor: pointer; color: var(--seed-fg-muted); display: inline-flex; align-items: center; justify-content: center; }
.seed-fm-viewtoggle button[aria-pressed="true"] { background: var(--seed-sunken); color: var(--seed-fg); }
.seed-fm-hint { width: 100%; font-size: 12px; color: var(--seed-fg-faint); margin: 0; }
.seed-fm-hint svg { margin-right: 6px; vertical-align: -2px; }
.seed-fm-hint .seed-fm-linkbtn { margin-left: 6px; }
.seed-fm-linkbtn { border: 0; background: none; color: var(--seed-accent); cursor: pointer; padding: 0; font-size: inherit; text-decoration: underline; text-underline-offset: 2px; }

.seed-fm-body { padding: 16px 20px 24px; }
.seed-fm-section-label { font-size: 11.5px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--seed-fg-faint); margin: 4px 0 8px; }
.seed-fm-folders { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; margin: 0 0 20px; padding: 0; list-style: none; }
.seed-fm-folder { width: 100%; display: flex; align-items: center; gap: 10px; padding: 10px 12px; margin: 0; border: 1px solid var(--seed-border); border-radius: var(--seed-radius-md); background: var(--seed-surface); cursor: pointer; text-align: left; min-width: 0; }
.seed-fm-folder:hover { background: var(--seed-hover); }
.seed-fm-folder > svg { color: var(--seed-fg-muted); }
.seed-fm-folder > span { min-width: 0; display: flex; flex-direction: column; }
.seed-fm-folder-name { font-weight: 600; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.seed-fm-folder-meta { font-size: 11.5px; color: var(--seed-fg-muted); font-variant-numeric: tabular-nums; }
.seed-fm-folders li { position: relative; }
.seed-fm-folders li .seed-fm-folder { padding-right: 40px; }
.seed-fm-folder-delete.seed-fm-btn { position: absolute; top: 50%; right: 6px; transform: translateY(-50%); width: 28px; height: 28px; color: var(--seed-fg-muted); opacity: 0; }
.seed-fm-folders li:hover .seed-fm-folder-delete, .seed-fm-folder-delete.seed-fm-btn:focus-visible { opacity: 1; }
.seed-fm-folder-delete.seed-fm-btn:hover:not(:disabled) { color: var(--seed-danger); }
@media (hover: none) { .seed-fm-folder-delete.seed-fm-btn { opacity: 1; } }

.seed-fm-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(156px, 1fr)); gap: 14px; margin: 0; padding: 0; list-style: none; }
.seed-fm-tile { position: relative; border-radius: var(--seed-radius-lg); cursor: pointer; min-width: 0; outline: none; }
.seed-fm-thumb { position: relative; aspect-ratio: 4 / 3; border-radius: var(--seed-radius-lg); overflow: hidden; background: var(--seed-sunken); border: 1px solid var(--seed-border); display: flex; align-items: center; justify-content: center; color: var(--seed-kind); }
.seed-fm-thumb--checker { ${CHECKER} background-size: 14px 14px; }
.seed-fm-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.12s ease; }
.seed-fm-thumb--checker img { object-fit: contain; }
.seed-fm-tile:hover .seed-fm-thumb { border-color: var(--seed-border-strong); }
.seed-fm-tile:focus-visible .seed-fm-thumb { outline: 2px solid var(--seed-accent); outline-offset: 2px; }
.seed-fm-tile[aria-selected="true"] .seed-fm-thumb { border-color: var(--seed-accent); box-shadow: 0 0 0 2px var(--seed-accent); }
.seed-fm-tile[aria-selected="true"] .seed-fm-thumb img { transform: scale(0.94); border-radius: 6px; }
.seed-fm-kind { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px; text-align: center; }
.seed-fm-ext { font-family: var(--seed-font-mono); font-size: 10.5px; font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; padding: 1px 6px; border-radius: 4px; background: color-mix(in srgb, var(--seed-kind) 14%, transparent); }
.seed-fm-kind-error { font-size: 11px; color: var(--seed-fg-faint); }
.seed-fm-skeleton { background: linear-gradient(90deg, var(--seed-sunken), var(--seed-hover), var(--seed-sunken)); background-size: 200% 100%; animation: seed-fm-shimmer 1.3s ease-in-out infinite; border-color: transparent; }
@keyframes seed-fm-shimmer { from { background-position: 100% 0; } to { background-position: -100% 0; } }
.seed-fm-check { position: absolute; top: 8px; left: 8px; width: 22px; height: 22px; margin: 0; border-radius: 6px; border: 1.5px solid rgb(255 255 255 / 0.9); background: rgb(0 0 0 / 0.28); color: #fff; display: flex; align-items: center; justify-content: center; opacity: 0; cursor: pointer; padding: 0; transition: opacity 0.1s; z-index: 1; }
.seed-fm-tile:hover .seed-fm-check, .seed-fm-tile:focus-visible .seed-fm-check, .seed-fm-check:focus-visible, .seed-fm[data-selecting="true"] .seed-fm-check, .seed-fm-tile[aria-selected="true"] .seed-fm-check { opacity: 1; }
.seed-fm-tile[aria-selected="true"] .seed-fm-check { background: var(--seed-accent); border-color: var(--seed-accent); color: var(--seed-accent-fg); }
.seed-fm-badge { position: absolute; bottom: 7px; right: 7px; font-size: 10.5px; font-weight: 600; padding: 2px 6px 2px 5px; border-radius: 5px; background: rgb(10 16 13 / 0.66); color: #fff; display: inline-flex; gap: 4px; align-items: center; }
.seed-fm-tile-meta { display: block; padding: 7px 2px 0; min-width: 0; }
.seed-fm-tile-name { display: block; font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.seed-fm-tile-sub { display: block; font-size: 11.5px; color: var(--seed-fg-muted); font-variant-numeric: tabular-nums; }

.seed-fm-list-wrap { overflow-x: auto; }
.seed-fm-list { width: 100%; border-collapse: collapse; font-size: 13px; }
.seed-fm-list th { text-align: left; font-size: 11.5px; font-weight: 600; color: var(--seed-fg-muted); padding: 6px 10px; border-bottom: 1px solid var(--seed-border); white-space: nowrap; background: none; }
.seed-fm-list td { padding: 7px 10px; border-bottom: 1px solid var(--seed-border); vertical-align: middle; }
.seed-fm-row { cursor: pointer; }
.seed-fm-row:hover td { background: var(--seed-hover); }
.seed-fm-row[aria-selected="true"] td { background: var(--seed-accent-soft); }
.seed-fm-num { text-align: right !important; font-variant-numeric: tabular-nums; white-space: nowrap; color: var(--seed-fg-muted); }
.seed-fm-when { white-space: nowrap; color: var(--seed-fg-muted); }
.seed-fm-namecell { display: flex; align-items: center; gap: 10px; min-width: 0; }
.seed-fm-namecell > span { min-width: 0; display: flex; flex-direction: column; }
.seed-fm-mini { width: 36px; height: 28px; border-radius: 5px; overflow: hidden; flex: none; border: 1px solid var(--seed-border); background: var(--seed-sunken); display: flex; align-items: center; justify-content: center; color: var(--seed-kind); }
.seed-fm-mini img { width: 100%; height: 100%; object-fit: cover; display: block; }
.seed-fm-mini.seed-fm-thumb--checker { background-size: 8px 8px; }
.seed-fm-mini.seed-fm-thumb--checker img { object-fit: contain; }
.seed-fm-row-name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 40ch; }
.seed-fm-row-open { display: block; border: 0; padding: 0; margin: 0; background: none; color: inherit; cursor: pointer; text-align: left; }
.seed-fm-visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.seed-fm-row-path { display: block; font-family: var(--seed-font-mono); font-size: 11px; color: var(--seed-fg-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 52ch; }
.seed-fm-actions { white-space: nowrap; text-align: right; }
.seed-fm-actions .seed-fm-btn { opacity: 0; height: 28px; width: 28px; }
.seed-fm-row:hover .seed-fm-actions .seed-fm-btn, .seed-fm-actions .seed-fm-btn:focus-visible { opacity: 1; }
.seed-fm-checkbox { width: 16px; height: 16px; margin: 0; accent-color: var(--seed-accent); cursor: pointer; vertical-align: middle; }
.seed-fm-type { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--seed-fg-muted); white-space: nowrap; }
.seed-fm-type::before { content: ""; width: 7px; height: 7px; border-radius: 2px; background: var(--seed-kind); }
.seed-fm-type small { color: var(--seed-fg-faint); font-size: inherit; }
@container seed-fm (max-width: 720px) {
  .seed-fm-col-type, .seed-fm-col-modified { display: none; }
  .seed-fm-row-path { max-width: 28ch; }
}
@container seed-fm (max-width: 520px) {
  .seed-fm-col-size { display: none; }
  .seed-fm-header { padding: 14px 14px 10px; }
  .seed-fm-toolbar { padding: 0 14px 10px; }
  .seed-fm-body { padding: 12px 14px 20px; }
  .seed-fm-grid { grid-template-columns: repeat(auto-fill, minmax(128px, 1fr)); gap: 10px; }
  .seed-fm-usage { flex-basis: 100%; order: 3; }
  .seed-fm-search { flex: 1 1 100%; }
}

.seed-fm-state { max-width: 400px; margin: 40px auto; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 8px; }
.seed-fm-state-icon { width: 48px; height: 48px; border-radius: 12px; background: var(--seed-sunken); display: flex; align-items: center; justify-content: center; color: var(--seed-fg-muted); margin-bottom: 4px; }
.seed-fm-state--error .seed-fm-state-icon { background: var(--seed-danger-soft); color: var(--seed-danger); }
.seed-fm-state h3, .seed-fm-state p { margin: 0; }
.seed-fm-state h3 { font-size: 15px; font-weight: 600; }
.seed-fm-state p { color: var(--seed-fg-muted); font-size: 13px; }
.seed-fm-state .seed-fm-btn { margin-top: 8px; }
:where(.seed-fm) :where(code) { font-family: var(--seed-font-mono); font-size: 0.92em; }
.seed-fm-state code { background: var(--seed-sunken); padding: 1px 5px; border-radius: 4px; }

.seed-fm-batch { position: sticky; bottom: 16px; z-index: 5; width: fit-content; max-width: calc(100% - 24px); margin: 0 auto 16px; display: flex; align-items: center; flex-wrap: wrap; justify-content: center; gap: 6px; padding: 6px 6px 6px 14px; background: var(--seed-fg); color: var(--seed-bg); border-radius: 12px; box-shadow: var(--seed-shadow); }
.seed-fm-batch-count { font-size: 13px; font-weight: 600; margin-right: 6px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.seed-fm-batch-count span { font-weight: 400; opacity: 0.7; }
.seed-fm-batch .seed-fm-btn { background: transparent; border-color: transparent; color: var(--seed-bg); height: 30px; }
.seed-fm-batch .seed-fm-btn:hover:not(:disabled) { background: color-mix(in srgb, var(--seed-bg) 14%, transparent); }
.seed-fm-batch .seed-fm-btn--danger-text { color: var(--seed-danger-inverse); }

.seed-fm-panel { position: fixed; top: 0; right: 0; bottom: 0; z-index: 1000; width: min(420px, 100vw); background: var(--seed-surface); color: var(--seed-fg); border-left: 1px solid var(--seed-border); box-shadow: var(--seed-shadow); display: flex; flex-direction: column; }
.seed-fm-panel-head { display: flex; align-items: center; gap: 4px; padding: 10px 10px 10px 16px; border-bottom: 1px solid var(--seed-border); }
.seed-fm-panel-head h3 { flex: 1; min-width: 0; margin: 0; font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.seed-fm-panel-body { flex: 1; overflow: auto; padding: 16px; display: flex; flex-direction: column; gap: 16px; }
.seed-fm-preview { border-radius: var(--seed-radius-md); overflow: hidden; border: 1px solid var(--seed-border); background: var(--seed-sunken); display: flex; align-items: center; justify-content: center; min-height: 180px; color: var(--seed-kind); }
.seed-fm-preview.seed-fm-thumb--checker { background-size: 16px 16px; }
.seed-fm-preview img { max-width: 100%; max-height: 320px; display: block; }
.seed-fm-preview pre { margin: 0; padding: 12px 14px; align-self: stretch; width: 100%; font-family: var(--seed-font-mono); font-size: 11.5px; line-height: 1.55; color: var(--seed-fg); overflow: auto; max-height: 320px; white-space: pre; }
.seed-fm-preview-note { padding: 28px; text-align: center; color: var(--seed-fg-muted); font-size: 12.5px; display: flex; flex-direction: column; align-items: center; gap: 8px; }
.seed-fm-preview-note svg { color: var(--seed-kind); }
.seed-fm-details { display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 8px 12px; margin: 0; font-size: 13px; }
.seed-fm-details dt { color: var(--seed-fg-muted); }
.seed-fm-details dd { margin: 0; min-width: 0; font-variant-numeric: tabular-nums; }
.seed-fm-details small { color: var(--seed-fg-faint); font-size: 12px; }
.seed-fm-path { display: flex; gap: 4px; align-items: flex-start; }
.seed-fm-path code { font-size: 11.5px; word-break: break-all; flex: 1; padding-top: 4px; }
.seed-fm-path .seed-fm-btn { width: 26px; height: 26px; }
.seed-fm-variants { display: flex; flex-direction: column; margin: 0; padding: 0; list-style: none; border: 1px solid var(--seed-border); border-radius: var(--seed-radius-md); overflow: hidden; }
.seed-fm-variants li { display: flex; justify-content: space-between; padding: 6px 10px; font-size: 12.5px; border-bottom: 1px solid var(--seed-border); font-variant-numeric: tabular-nums; }
.seed-fm-variants li:last-child { border-bottom: 0; }
.seed-fm-variants li span:last-child { color: var(--seed-fg-muted); }
.seed-fm-panel-foot { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--seed-border); }
.seed-fm-panel-foot .seed-fm-btn--primary { flex: 1; }

/* margin: auto restates the UA default that centres a modal; Tailwind's preflight resets it to 0. */
.seed-fm-dialog { margin: auto; border: 1px solid var(--seed-border); border-radius: var(--seed-radius-lg); background: var(--seed-surface); color: var(--seed-fg); box-shadow: var(--seed-shadow); width: min(460px, calc(100vw - 32px)); max-height: calc(100vh - 32px); padding: 0; }
.seed-fm-dialog::backdrop { background: var(--seed-backdrop); }
.seed-fm-dialog form { display: flex; flex-direction: column; gap: 12px; margin: 0; padding: 20px; }
.seed-fm-dialog h3 { margin: 0; font-size: 16px; font-weight: 600; overflow-wrap: anywhere; }
.seed-fm-dialog p { margin: 0; font-size: 13px; color: var(--seed-fg-muted); }
.seed-fm-dialog ul { margin: 0; padding: 0; list-style: none; border: 1px solid var(--seed-border); border-radius: var(--seed-radius-md); max-height: 160px; overflow: auto; }
.seed-fm-dialog li { display: flex; justify-content: space-between; gap: 12px; padding: 6px 10px; font-size: 12.5px; border-bottom: 1px solid var(--seed-border); }
.seed-fm-dialog li:last-child { border-bottom: 0; }
.seed-fm-dialog li code { font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.seed-fm-dialog li span { color: var(--seed-fg-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.seed-fm-dialog label { display: flex; gap: 8px; align-items: center; font-size: 13px; cursor: pointer; }
.seed-fm-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
.seed-fm-warning { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: var(--seed-radius-md); background: var(--seed-warn-soft); color: var(--seed-warn); font-size: 12.5px; }
.seed-fm-warning svg { margin-top: 1px; }
.seed-fm-irreversible { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: var(--seed-radius-md); background: var(--seed-danger-soft); color: var(--seed-danger); font-size: 12.5px; }
.seed-fm-irreversible svg { flex: none; margin-top: 1px; }
.seed-fm-keepcopy { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; justify-content: space-between; padding: 10px 12px; border: 1px dashed var(--seed-border); border-radius: var(--seed-radius-md); font-size: 12.5px; color: var(--seed-fg-muted); }

.seed-fm-toasts { position: fixed; left: 16px; bottom: 16px; z-index: 1001; display: flex; flex-direction: column; gap: 8px; pointer-events: none; margin: 0; padding: 0; list-style: none; }
.seed-fm-toast { display: flex; align-items: center; gap: 8px; max-width: min(420px, calc(100vw - 32px)); padding: 9px 12px; background: var(--seed-surface); color: var(--seed-fg); border: 1px solid var(--seed-border); border-radius: var(--seed-radius-md); box-shadow: var(--seed-shadow); font-size: 13px; animation: seed-fm-toast-in 0.18s ease-out; }
.seed-fm-toast svg { color: var(--seed-accent); }
.seed-fm-toast--error svg { color: var(--seed-danger); }
@keyframes seed-fm-toast-in { from { transform: translateY(6px); opacity: 0.4; } }

@media (prefers-reduced-motion: reduce) {
  .seed-fm-skeleton, .seed-fm-btn[data-busy="true"] svg, .seed-fm-toast { animation: none; }
  .seed-fm-thumb img { transition: none; }
}
`

export const OPFS_FILES_MANAGER_CSS = `@layer ${STYLE_LAYER} {\n${CSS}\n}`

/** Inject the stylesheet once. No-op during SSR. */
export function ensureStylesInjected(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ELEMENT_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ELEMENT_ID
  el.textContent = OPFS_FILES_MANAGER_CSS
  document.head.appendChild(el)
}
