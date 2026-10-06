# 0005. A shared design system for exported UI

- **Status:** Proposed
- **Date:** 2026-10-06
- **Scope:** `@seedprotocol/react`, `@seedprotocol/mapping`, `@seedprotocol/publish`

## Context

[0002](0002-component-styling-tokens-and-injected-css.md) sets how a component styles
itself, and `OPFSFilesManager` now follows it. The other exported UI doesn't yet:

| Component | Package | Today |
|---|---|---|
| `FieldMapper`, `LookupEditor` | mapping | Injected stylesheet with `--sfm-*` / `--fm-*` tokens. Closest to 0002 |
| `PublishModeButtons` | publish | Inline styles, hard-coded hex (`#101828`, `#D0D5DD`) |
| `ConnectButton` | publish | thirdweb theme object with hard-coded hex |
| `SeedClientGate` | react | Inline styles, unstyled "Loading..." text |
| `SeedImage`, `SeedMedia*`, `SeedHtml`, `SeedJson` | react | Unstyled pass-through elements |

Each component also builds its own buttons, dialogs, and loading states. Mapping and
publish don't depend on `@seedprotocol/react`, so they can't share code with it today.

## Proposed decision

1. **Tokens first.** Define one `--seed-*` token set (colors in light and dark, radii,
   spacing, type) as a CSS string plus a TS constant, importable from any package. The
   values from `OPFSFilesManager/styles.ts` are the starting point.
2. **Internal primitives.** Button, IconButton, Checkbox, SegmentedControl, Dialog,
   Toast, Badge, Spinner, Skeleton, EmptyState, and the vendored icons
   ([0003](0003-icons-vendored-from-lucide.md)). They aren't exported at first.
3. **Migrate.** `PublishModeButtons` becomes a SegmentedControl. `SeedClientGate` uses
   the shared spinner. `FieldMapper` aliases `--fm-*` to `--seed-*` while keeping its own
   variables working as overrides. `ConnectButton` builds its thirdweb theme from token
   values.
4. **Pass-through components stay unstyled.** Only their shared loading and error states
   adopt tokens.
5. **Package.** Create a small `@seedprotocol/ui` package once primitives have more than
   two consumers. Until then, tokens live in one module that other packages copy or
   import.

## Open questions

- Should `@seedprotocol/ui` export the primitives publicly, or keep them internal so
  hosts use their own (for example shadcn)?
- Should the token set mirror shadcn's variable names (`--background`, `--primary`) so
  hosts like Permapress can map their theme in one place?
- Do we ship a static `.css` file next to runtime injection for CSP-strict hosts?

## Consequences if accepted

- Every exported component follows the same theme prop, token names, and override
  story.
- One place to adjust contrast, dark mode, and focus styles.
- `FieldMapper` and `PublishModeButtons` would change appearance slightly. That needs a
  minor version bump and release notes.
