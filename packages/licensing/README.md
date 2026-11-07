# @seedprotocol/licensing

License terms, a catalog of licenses, plain-language deeds and a license chooser for Seed Protocol.
It doesn't depend on `@seedprotocol/sdk`, so it runs in a browser, a server render or an agent.

```bash
bun add @seedprotocol/licensing
```

## A license picker

```ts
import { renderDeed, summarySentence } from '@seedprotocol/licensing'
import { ccChooser } from '@seedprotocol/licensing/catalog/cc'

// Draw ccChooser.questions; each choice has an id, a label and `ends` when it settles the answer.
const choice = ccChooser.resolve({ republish: 'yes', conditions: 'credit', adapt: 'yes', commercial: 'no' })
// → { spdx: 'CC-BY-NC-4.0', termsHash: '0x…', module }

const terms = choice!.module.toTerms()
summarySentence(terms, { locale: 'en' })
// 'Anyone may republish and adapt it with credit, but not commercially.'

const deed = renderDeed(terms, { locale: 'en', stewardDeedUrl: choice!.module.stewardDeedUrl })
// deed.youCan, deed.youMust, deed.youCannot, deed.whenTimeRunsOut, deed.creatorPromises: { rule, text }[]

ccChooser.answersFor('CC-BY-NC-4.0') // the answers, to redraw a saved choice
```

The chooser covers CC0 1.0, the six CC BY 4.0 licenses and All rights reserved
(`LicenseRef-seed-all-rights-reserved-1`).

## Terms and their hash

`SeedLicenseTerms` describes what a license permits, prohibits and requires, as a closed ODRL 2.2
profile. `termsHash(terms)` is the SHA-256 of their RFC 8785 canonical JSON, and is what a
`licenseOffer` refers to. `validateTerms` checks terms without throwing; `termsHash` throws
`InvalidLicenseTermsError` on invalid ones. `terms.schema.json` is the same shape as JSON Schema.
ADR 0034 records what the hash covers.

```ts
import { createLicenseCatalog, termsHash } from '@seedprotocol/licensing'
import { creativeCommons } from '@seedprotocol/licensing/catalog/cc'

const catalog = createLicenseCatalog(creativeCommons)
catalog.byTermsHash(hash)   // { module, terms } for a hash read from an offer
catalog.bySpdx('CC0-1.0')
```

## SPDX and URLs

`parseSpdx(expression)` parses SPDX license expressions against the SPDX License List 3.29.0
(`SPDX_LIST_VERSION`). `fromUrl(url)` returns the SPDX id a license URL names, such as a Creative
Commons deed URL found in a feed, or `null`.

## Deeds are drafts

Deed and summary sentences are Seed's own wording, not the stewards', and haven't been reviewed by
counsel: every deed has `reviewed: false`. A deed opens by saying the legal text governs and names
it by URL and SHA-256. The legal texts are in `legal/` in the repository (not in the npm package);
`legal/NOTICE.md` says where they come from.
