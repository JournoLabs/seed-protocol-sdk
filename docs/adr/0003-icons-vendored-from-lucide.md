# 0003. Vendor Lucide icons instead of depending on an icon package

- **Status:** Accepted
- **Date:** 2026-10-06
- **Scope:** Icons in exported UI components. First applied in `packages/react/src/OPFSFilesManager/icons.tsx`.

## Context

No package in this repo depends on an icon library. `OPFSFilesManager` had five
Heroicons outline paths pasted inline at stroke width 1.5, each with hard-coded sizes.
The mapping and publish components have no icons.

Permapress, the main consumer, uses `lucide-react` (through shadcn) in about 55 files.
Lucide draws at stroke width 2 on a 24×24 grid, so Heroicons placed next to it look
slightly lighter and differently proportioned.

The redesigned file manager needs about 20 icons.

## Decision

Use **Lucide** as the icon set, and **vendor** the icons we use into one internal
module per package rather than adding `lucide-react` as a dependency.

- Icons live in `icons.tsx` as a map from name to SVG children, rendered by a single
  `<Icon name size strokeWidth />` component.
- Keep Lucide's 24×24 viewBox, `stroke="currentColor"`, round caps and joins, and
  stroke width 2 by default, so our icons match hosts that use `lucide-react`.
- Icons are decorative (`aria-hidden`). The button or control around them carries the
  accessible name.
- The file header credits Lucide (ISC License, Copyright Lucide Contributors).
- To add an icon, copy the SVG children from lucide.dev into the map.

## Consequences

- No new runtime dependency for SDK consumers, and no version conflicts.
- Visual consistency with Permapress and other shadcn-based hosts.
- Icons don't update automatically. That's fine for a small, stable set.
- If a second package needs icons before a shared UI package exists, it gets its own
  `icons.tsx` or imports from a shared module. Revisit when
  [0005](0005-shared-design-system.md) is decided.

## Alternatives considered

- **`lucide-react` as a dependency.** It tree-shakes well, but it's still on 0.x, so a
  caret range like `^0.577.0` only matches 0.577.x. Hosts on a different minor end up
  with two copies.
- **`lucide-react` as a peer dependency.** Forces every consumer to install it, even
  those that never render a component.
- **Keep inline Heroicons.** Doesn't match the main consumer, and the scattered
  one-off components made sizes inconsistent.
- **Generate from `lucide-static` with a script.** Reasonable once we have many icons.
  With about 20 it's more machinery than copying by hand.
