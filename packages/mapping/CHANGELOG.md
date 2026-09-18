# Changelog

## Unreleased

- Allow one source to map to multiple properties (edge-list fan-out); each property remains exclusive.
- `autoMap` fans `link` / `url` sources out to matching URL-ish targets (`importUrl`, `canonicalUrl`, `url`, `link`, `permalink`).
- `FieldMapper` supports attaching multiple properties from an active source without clearing prior edges.

## 0.5.1

- Initial Phase 1 release: headless mapping core, markdown + RSS adapters, `FieldMapper` UI.
