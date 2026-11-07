# 0034. License terms are a closed ODRL profile identified by termsHash

- **Status:** Accepted
- **Date:** 2026-11-06
- **Scope:** `@seedprotocol/licensing`; later the `licenseOffer` and `licenseTerms` EAS records

## Context

PermaPress needs a license picker: an author answers a few questions, sees a summary, and the
choice is later attested in a `licenseOffer` that refers to the terms by hash. The hash is a
public identifier on day one, so what it covers can't change once offers exist. SPDX ids name
licenses but don't describe permissions. Raw ODRL is verbose and read inconsistently. Deed wording
is still a draft awaiting counsel review, and the legal texts aren't stored on Arweave yet.

## Decision

`@seedprotocol/licensing` defines `SeedLicenseTerms`, a TypeScript type whose meaning is the closed
ODRL 2.2 profile `https://seedprotocol.io/odrl/seed-license/1`. The profile has a fixed set of
actions (ODRL's `use`, `reproduce`, `distribute`, `derive`, `commercialize`, plus `seed:aiTrain`,
`seed:aiInput`, `seed:aiIndex`, `seed:search`), constraints, duties and grant fields. Offer
economics (price, currency, payee, supply) are not part of terms.

`termsHash(terms)` is `0x` and the lowercase hex SHA-256 of the terms' RFC 8785 canonical JSON.
Terms may hold only integers as numbers, and an optional field set to `undefined` is the same as
an absent one. `validateTerms` must pass before a hash is computed.

The hash covers `legal.sha256`, `legal.lang` and `legal.canonicalUrl`, not where the legal text is
stored: an Arweave transaction id lives in the offer or `licenseTerms` record, so uploading or
mirroring a text never changes a hash. For catalog licenses on the SPDX list, `legal.sha256` is the
SHA-256 of `text/<id>.txt` from `spdx/license-list-data` at tag `v3.29.0`, vendored in
`packages/licensing/legal/`.

The hash doesn't cover the deed template. Deeds and one-sentence summaries are derived from terms
through a closed rule vocabulary (template `seed-deed/1.0.0`), carry `reviewed: false` until counsel
reviews the sentences, and say that the legal text governs. A term no rule covers renders as a line
pointing to the legal text, never as nothing.

Catalog module ids (`cc-by-nc@4.0.0`) are frozen once released; a change makes a new version.
Adding an optional field or union member to the profile keeps existing hashes; changing what an
existing field means needs a new profile URL.

## Consequences

One license resolves to one hash, which a reader can map back to a catalog module offline
(`catalog.byTermsHash`). Rewording a deed after counsel review leaves every hash and every attested
offer valid. What a licensee was shown is not recorded by `termsHash`; L1's `acceptanceHash` over
the rendered deed bytes records it. Deeds for terms outside the 1.0.0 vocabulary (constraints, a
share-alike to another license) read "see the legal text" until the vocabulary grows.

## Alternatives considered

- **Hash the deed template version with the terms**, as the licensing report sketched: every
  wording change would give every module a new hash and strand attested offers, and the renderer
  would have to keep every released template.
- **Include the Arweave transaction id in the hash:** hashes would change when the texts are
  uploaded, and differ between copies of the same text.
- **Raw ODRL JSON-LD as the model:** verbose, harder to validate, and no gain over exporting ODRL
  from this model later.
- **A catalog of SPDX ids with hand-written deeds and no term model:** nothing to hash, and paid
  templates in L1 couldn't reuse the deeds.
