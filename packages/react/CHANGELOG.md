# Changelog

All notable changes to this package are documented in this file.

## 0.7.3 (2026-10-14)

### Commits

#### Fixes

- sdk: addressFilter 'owned' lists what isItemOwned says is owned (f31e5991)
- progressive image URL tries the preferred read gateways (83a9dd02)
- ci: wait longer for npm to show published versions before promoting (c884e492)

## 0.7.1 (2026-10-10)

### Commits

#### Features

- useItem re-renders when one of the item's property values changes (93019eff)
- useItem / useItemProperty return cached ready instances on the first render (6837417d)
- delete folders from OPFSFilesManager (20adaee2)

## 0.7.0 (2026-10-08)

### Commits

#### Breaking

- redesign OPFSFilesManager (4cdf8807)

#### Features

- sdk: keep other tabs current with relayed events and file changes (4492a824)
- SeedClientGate reports init failures through onInitError (a9b6af6d)
- sdk: require a schema when a model name is ambiguous (631df2d5)
- add deleteAction to OPFSFilesManager (841c33fd)
- add onNotify to OPFSFilesManager (97e790d1)

#### Fixes

- sdk: getPropertySchema finds runtime properties on schema-file models (61449bee)
- useModelProperty retries a lookup that found nothing (463b701c)
- useModelProperties follows the model's _dbId (5e3a8be2)
- sdk: readers prefer a live metadata row over a newer revoked one (b2432397)
- keep useItems query key shape unchanged when unscoped (a883de05)
- sdk: scope Item property resolution to the model's schema (9a72d9eb)
- track destroy isLoading/error in hook-local state for all destroy hooks (e46253ad)
- make useDestroySchema report isLoading for fast destroys (9764380c)
- stop OPFSFilesManager's element reset overriding button styles (ac561ebc)
- require @seedprotocol/sdk ^0.6.0 as a peer (6acb12d7)
- build against the workspace SDK, not npm 0.4.25 (e2a978f1)

#### Other

- sdk: drop unused destroy-progress state from entity machines (9c27162c)
- adr: start ADRs; record OPFSFilesManager design decisions (5c00b2d3)

## 0.6.10 (2026-10-04)

### Commits

#### Other

- Fixing gas estimation. v0.6.10 (d5b161a1)

## 0.6.8 (2026-10-03)

### Commits

#### Other

- Final changes (b9f033a2)

## 0.6.7 (2026-10-01)

_Also covers 0.6.4, 0.6.5, 0.6.6, published from commits in this range._

### Commits

#### Other

- Final edits (687d320b)
- Add ensureImageLocal and progressive SeedImage Arweave fallback. (14f0156f)
- Stop treating a failed client init as ready. (b32df5e7)

## 0.6.3 (2026-09-25)

_Also covers 0.6.1, 0.6.2, published from commits in this range._

### Commits

#### Other

- Fixing item ownership bugs/gaps (2539c65c)

## 0.6.0 (2026-09-22)

### Commits

#### Features

- mapping: add resolve jobs, URL classifier, and AV media roles (ac9ef29c)

## 0.5.3 (2026-09-17)

_Also covers 0.5.2, published from commits in this range._

### Commits

#### Features

- sdk: add client.removeLocalCopiesForAddresses local purge (236098a0)
