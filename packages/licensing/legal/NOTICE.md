# Legal texts

The `*.txt` files whose names are SPDX ids are copied byte for byte from
[spdx/license-list-data](https://github.com/spdx/license-list-data) at tag `v3.29.0`, file
`text/<id>.txt`, by `scripts/pin-legal-texts.ts`. Each is the license's legal text, published by
its steward (Creative Commons for the files here). A module's `legal.sha256` is the SHA-256 of its
file, and `hashes.generated.json` lists them all.

`LicenseRef-seed-all-rights-reserved-1.txt` is written by Seed Protocol.

These files aren't in the npm package. They're kept so the hashes can be checked offline and so the
same bytes can be uploaded where a deed's legal text is served from.
