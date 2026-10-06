# 0002. Style exported components with `--seed-*` tokens and an injected stylesheet

- **Status:** Accepted
- **Date:** 2026-10-06
- **Scope:** UI components exported from `@seedprotocol/react`, `@seedprotocol/mapping`, `@seedprotocol/publish`. First applied to `OPFSFilesManager`.

## Context

Exported components were styled three different ways:

| Component | Approach |
|---|---|
| `OPFSFilesManager` (before) | Tailwind class names, inline style objects, a JS map of light/dark classes |
| `PublishModeButtons`, `ConnectButton` | Inline styles and hard-coded hex values |
| `FieldMapper` | A stylesheet injected once into `document.head`, CSS custom properties (`--fm-*`), theme modes including `none`, and `classNames` slots |

The Tailwind approach doesn't work for a published library. The package ships no CSS,
and Tailwind only generates classes it finds in the host's sources. Tailwind v4 skips
`node_modules` unless the host adds an `@source` line. Permapress, the main consumer,
has none, so the component only got classes Permapress happened to use elsewhere.
`bg-indigo-600`, `pl-4`, `sm:pl-6` and `py-3.5` weren't among them, which left the
Refresh button as white text on a white background and the table cells without their
left padding.

Inline styles can't respond to hover, focus, dark mode, or container size, and hosts
can't override them without `!important`.

## Decision

Exported components style themselves with **scoped class names, CSS custom properties,
and one stylesheet injected at runtime**. This follows `FieldMapper`'s model.

1. **Tokens.** Every color, radius, and shadow comes from a `--seed-*` custom property
   (`--seed-fg`, `--seed-accent`, `--seed-danger`, `--seed-kind-image`, …) defined on
   the component root. Light values are the default. Dark values apply under
   `[data-seed-theme="dark"]`, and under `[data-seed-theme="system"]` inside
   `@media (prefers-color-scheme: dark)`.
2. **Class names** are prefixed per component (`seed-fm-*` for OPFSFilesManager) and are
   a stable public hook. Renaming one is a breaking change.
3. **Injection.** The CSS lives in a TS module as a string. On first render the
   component calls an `ensure…Injected()` function from `useInsertionEffect`, which
   appends one `<style id="…">` to `document.head` and does nothing during SSR. The
   string is also exported (`OPFS_FILES_MANAGER_CSS`) for hosts that need it at build
   time, such as an SSR `<head>` or a strict CSP that blocks inline styles.
4. **Cascade layer.** The CSS is wrapped in a named `@layer` (`seed-opfs-files-manager`),
   so any unlayered host CSS beats it without needing higher specificity.
5. **One theme prop:** `theme?: 'system' | 'light' | 'dark' | 'none'`, defaulting to
   `'system'`. `'none'` skips injection and leaves only the class names.
6. **`classNames` prop:** `Partial<Record<Slot, string>>` for adding host classes to
   named elements.
7. **Fonts inherit** from the host (`font-family: inherit`). Only the monospace stack is
   set, through `--seed-font-mono`.
8. **Layout uses container queries** on the component's own width, not viewport media
   queries, so the same component works in a sidebar and on a full page.

## Consequences

- Components look right in any host without Tailwind or any build configuration.
- Hosts restyle by overriding `--seed-*` variables on the root or an ancestor. That's
  the recommended path and covers most needs.
- **Layer order caveat.** Our layer is declared when the style tag is appended, which is
  usually after the host's own layers. Tailwind v4 puts its utilities in a layer, so a
  Tailwind class passed through `classNames` can lose to our rules for the same
  property. To win, hosts can override variables, write unlayered CSS, use Tailwind's
  important modifier (`bg-red-500!`), or use `theme="none"`. We accepted this because
  the alternative is worse. Prepending our stylesheet would put it under Tailwind's
  preflight layer, and preflight would reset our buttons and inputs.
- **Element defaults have zero specificity.** Rules that target elements inside the
  component (`button`, `input`, `select`, `svg`, `code`) are written as
  `:where(.seed-fm) :where(button, …)`, so any component class beats them. The first
  version used `.seed-fm button` at (0,1,1). That beat every single-class variant, which
  left the primary button's label unreadable in dark mode and the danger text uncoloured.
  Our layer still beats Tailwind's preflight whatever the specificity, because layer
  order is decided before specificity.
- **Restate browser defaults we rely on.** Being in a later layer only wins for
  properties we set. Preflight resets `margin` to 0 everywhere, which removes the
  browser's `margin: auto` that centres a modal `<dialog>`, so `.seed-fm-dialog` sets
  `margin: auto` itself.
- Injected `<style>` tags need `style-src 'unsafe-inline'` or a nonce under a strict
  CSP. Hosts in that situation can render `OPFS_FILES_MANAGER_CSS` themselves.
- During development, edits to the CSS string need a full page reload, because the
  style tag is only injected once.
- `FieldMapper` uses `--fm-*` / `--sfm-*` today. Aligning it is tracked in
  [0005](0005-shared-design-system.md).

## Alternatives considered

- **Keep Tailwind classes and document an `@source` line for hosts.** This depends on
  every host's build setup and Tailwind version, and it breaks silently when missed,
  as it did in Permapress.
- **Ship a `.css` file that hosts import.** Clean, but it's easy to forget the import,
  and the component renders unstyled with no error. We may add this alongside
  injection later.
- **CSS-in-JS runtime (emotion, styled-components).** Adds a runtime dependency and
  per-render cost to an SDK for no benefit over a static string.
- **Inline styles.** No pseudo-classes, media queries, or container queries, and hard
  to override.
