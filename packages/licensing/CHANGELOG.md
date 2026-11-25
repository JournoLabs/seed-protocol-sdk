# Changelog

All notable changes to this package are documented in this file.

## Unreleased

- **Breaking:** `validateTerms` rejects an `spdx`, share-alike `license` or `transition.changeLicense` that isn't written canonically (SPDX list case, single spaces, no redundant parentheses), so `cc-by-4.0` no longer validates and hashes differently from `CC-BY-4.0`. The error gives the canonical spelling. `termsHash` does not normalize; it throws on such terms like `validateTerms` does.
- `canonicalSpdx(expression)` returns the canonical spelling of an SPDX expression.
- `createLicenseCatalog` throws on a duplicate terms hash, as it does on a duplicate id or SPDX id. Before, `byTermsHash` returned the later module.
- `summarySentence` says "republish" only when the terms grant sharing. Terms granting other actions only (for example `seed:aiTrain`, `seed:search`, `derive`, `reproduce`) get "Others may use it only as the license text allows." Terms granting `use` with conditions say "use it for any purpose".
- `terms.schema.json` caps integers at 9007199254740991, as `validateTerms` does.
- `ACTIONS`, `USER_CLASSES` and `RULE_IDS` are exported.
- `offerInForce` and `licenseHistory`: which license offer is in force at a time, by the rule in ADR 0039.

## 0.8.3 (2026-11-23)

- New package: license terms, `termsHash`, SPDX parsing, the Creative Commons catalog, deeds and the license chooser.
