# 0004. OPFSFilesManager: thumbnails, grouping, downloads, and deletes

- **Status:** Accepted
- **Date:** 2026-10-06
- **Scope:** `@seedprotocol/react` — `OPFSFilesManager`, `useOPFSFiles`, `opfsPaths.ts`

## Context

`OPFSFilesManager` was a flat table of every file in OPFS with download and delete
buttons. Against the layout the SDK actually writes, that had several problems:

- **Resized copies flood the list.** The SDK saves each image under `files/images/` and
  writes WebP copies to `files/images/<width>/<name>.webp` for widths 480–1920. One
  image becomes six rows.
- **No previews.** Images were indistinguishable except by name, and many names are
  43-character Arweave transaction IDs.
- **Wrong types.** OPFS stores no MIME type, so `File.type` comes from the extension.
  Images downloaded from Arweave are saved under their transaction ID with no
  extension, and the SQLite database is `seed.db`. Both showed as
  `application/octet-stream`.
- **Multi-file download didn't work.** It fired one download every 100 ms, and browsers
  block every automatic download after the first.
- **Native dialogs.** `alert()` and `confirm()` block the thread, can't be styled, and
  are suppressed in some iframes and embedded webviews.
- **Order of `onBeforeDelete`.** For a single delete it ran *before* the user confirmed,
  so host side effects could happen for a delete the user then cancelled.
- **Selection reset** whenever the number of files changed, including on refresh.

## Decision

**Navigation.** Show folders with breadcrumbs instead of a path column. Search matches
names and paths at any depth below the current folder. Sort by name, recently
modified, or largest. Folders that are mostly images open in a grid, others in a list,
until the user picks a view (`defaultView` overrides this).

**Grouping (`groupImageVariants`, default true).** Attach `…/images/<width>/<base>.webp`
files to the original `…/images/<base>.<ext>` (or the extensionless transaction-ID
file) and hide them from the listing. The tile shows a "N sizes" badge, the details
panel lists each copy, and delete offers to remove them too. A copy whose original is
missing stays in the list. Users can switch to "Show as folders".

**Thumbnails.** Use the narrowest resized copy when one exists, since the SDK has
already made it and it needs no decoding on our side. Otherwise read the original and,
if it's over 256 KB, downscale it with `createImageBitmap` to about 400 px wide.
Thumbnails load only when a tile comes within 300 px of the viewport, run at most four
at a time, and share an object-URL cache that revokes a URL 30 s after its last user
unmounts. A file that won't decode says so instead of showing a broken image.

**Type detection.** When `File.type` is empty, `useOPFSFiles` reads the first 16 bytes
and sets `detectedType` for JPEG, PNG, GIF, WebP, AVIF, SQLite, and PDF signatures.
`type` keeps its old value for compatibility. The UI shows the detected type and marks
it as detected.

**Downloads.** A single file downloads as before. Several files are written into one
**store-only ZIP** (no compression, no dependency, about 100 lines) and saved once. With
a custom `onDownload`, the handler is called once with the zip blob and a synthetic
`OPFSFile` whose `type` is `application/zip`.

**Deletes.**
- Confirmation is an in-component modal `<dialog>` that lists what will be removed and
  explains that copies on Arweave aren't affected.
- `deleteWarning(files)` adds a warning to the dialog. The default flags
  `db/seed.db`, because deleting it discards local items and unpublished drafts.
- `confirmDelete(files)` replaces the built-in dialog for hosts with their own.
- `deleteAction(files)` returns `{ label?, destructive? }`. `label` replaces "Delete" on
  the batch bar, row action, panel footer, and the dialog's heading and confirm button.
  `destructive: false` drops the danger colour and uses the primary confirm button. The
  host knows whether a file also exists elsewhere, such as on Arweave, and the component
  doesn't. The dialog calls it again when the resized-copies checkbox changes, so labels
  that include a count stay accurate. Row `aria-label`s keep the file name so rows stay
  distinguishable.
- `onBeforeDelete` runs per file **after** confirmation. Files it vetoes are reported
  in the result toast.
- There's no Undo, because OPFS deletes are permanent.
- Folders have their own delete button. The folder dialog says outright that the delete
  can't be undone and offers **Download .zip** first. The zip's paths start at the
  folder's name, and the dialog stays open after saving. The folder's files are deleted
  one by one, the same way as a file delete, so `onBeforeDelete`, `confirmDelete`,
  `deleteWarning` and `deleteAction` all still apply. Then any folders left empty are
  removed. Files that a hook keeps or that `filter` hides stay where they are, and so does
  their folder. The `delete` notice adds `folder` and `folderRemoved`. Resized copies under
  the folder are always included, because the folder is going away.

**Feedback.** Toasts replace `alert()` for results and errors. Errors name the cause,
for example a `NotFoundError` for a missing `rootPath`, or OPFS being unsupported.
Hosts with their own toaster pass `onNotify(message, tone, notice)`, and the built-in
toasts aren't rendered. `notice` says what happened (`delete` with deleted, skipped and
failed paths plus the folder, if one was deleted; `download`; or `copy-path`) so hosts
can write their own wording.

**Structure.** The component lives in `src/OPFSFilesManager/`, split into views,
dialog, panel, hooks, and pure helpers (`fileModel.ts`, `format.ts`, `zip.ts`). OPFS
path traversal is shared through `src/opfsPaths.ts`, which `OPFSImage` also uses.

## Consequences

- **Breaking:** `theme` defaults to `'system'` instead of `'dark'` (see
  [0002](0002-component-styling-tokens-and-injected-css.md)). Hosts that relied on the
  dark default must pass `theme="dark"`. Permapress passes `theme="light"` and is
  unaffected.
- **Breaking:** `onBeforeDelete` is now called after the user confirms. Hosts that used
  it to show their own confirmation should move that logic to `confirmDelete`.
- `useOPFSFiles` gains `detectedType` on files, plus `hasLoaded` and `errorName` in its
  return value. All are additive. Each extensionless file costs one extra 16-byte read
  per scan.
- The ZIP writer has no ZIP64 support. Selections over 4 GB or 65,535 files fail with a
  clear message.
- Grouping relies on the SDK's `images/<width>/` naming. If that convention changes,
  `parseImageVariant` in `fileModel.ts` has to change with it.

## Alternatives considered

- **Hide resized copies entirely.** Simpler, but a debugging tool that hides files is
  misleading, and they take real space. Grouping keeps them visible and accounted for.
- **Generate every thumbnail from the original.** Wastes work the SDK has already done,
  and decoding a dozen 4000 px JPEGs at once stalls the page.
- **A zip library (fflate, JSZip).** Compression gains little on JPEG, WebP, and
  SQLite, and it would add a dependency.
- **A file-picker save (`showSaveFilePicker`).** Chromium-only and not available inside
  iframes.
