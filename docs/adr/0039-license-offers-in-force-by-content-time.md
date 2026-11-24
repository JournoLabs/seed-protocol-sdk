# 0039. A license offer is an attestation on a Version, in force by content time

- **Status:** Accepted
- **Date:** 2026-11-23
- **Scope:** `@seedprotocol/eas` (`LICENSE_OFFER_SCHEMA_*`, `getLicenseOffersFromEas`), `@seedprotocol/licensing`
  (`offerInForce`, `licenseHistory`), `@seedprotocol/publish` (`licenseOffer` option), `@seedprotocol/query`
  (`getLicense`, `getLicenseHistory`)

## Context

[ADR 0034](0034-license-terms-and-terms-hash.md) identifies a set of license terms by `termsHash`. A
publisher now has to say, onchain, which terms a Seed is offered under, and a reader has to say which
terms governed a given Version at a given time.

The licensing report proposed an offer with `versionUid = 0` for "this and every later version",
attested `revocable=false` so an open license couldn't be withdrawn. Two facts rule that out:

- Seed's `multiPublish` (`SeedPublishLib.prepareProperties`) makes every attestation in the batch
  revocable, so an offer sent with a publish can't be irrevocable.
- In that batch a zero `refUID` becomes the Version the batch attests, and a new Seed's uid isn't known
  before the batch. An offer sent with a publish naturally points at the Version, not the Seed.

An author also changes their mind: PermaPress lets a post move from CC BY to All rights reserved and
back. CC 4.0 licenses can't be withdrawn for what was already published under them, so a change can
only govern content published after it. A Version can gain content without a new Version: a `patch`
publish attests new property values under the same Version uid.

## Decision

An offer is an attestation under `LICENSE_OFFER_SCHEMA_DEF`:

```
bytes32 terms_hash,string spdx,bytes32 legal_tx,uint256 price,address currency,address payee,uint64 duration,uint64 max_grants,bytes32 access_policy,address gate_hook
```

Revocable, zero resolver, so `LICENSE_OFFER_SCHEMA_UID` is the same on every chain (ADR 0035). The
fields are fixed now for the later paid offers, because a schema can't change without a new UID.
`terms_hash` is ADR 0034's hash. `spdx` lets a reader without the catalog name the license.
`legal_tx` is the Arweave transaction of the legal text, zero when none is named. A free offer has
zero in every field after `legal_tx`; readers of this version treat an offer with a non-zero price as
they treat any other, since paid offers aren't defined yet.

`refUID` is a Version of the Seed. A reader counts an offer only if its attester is the Seed's
attester: anyone can attest with any `refUID`. An offer on any Version of the Seed counts for the
whole Seed.

**The rule.** A pin `(versionUid, asOf)` is licensed by the newest counted offer attested at or before
the newest attestation the pin shows. The pin shows the Version's own attestation and each property's
current attestation as of `asOf`; one revoked by `asOf` isn't shown. Same-second counts as "at or
before", so an offer sent in the same batch as the content governs it. Without `versionUid` the pin is
the Seed's newest Version live at `asOf`; without `asOf` it is now. Once `asOf` is in the past a pin's
answer never changes.

**Revocation.** A revoked offer reads as reserved rights from its `revocationTime`, as if a
reserved-rights offer had been attested then. It never reaches back. Revoking an offer that a later
offer already replaced changes nothing. Within one second an offer takes effect before a revocation,
and offers take effect in uid order, so every reader picks the same one.

**Not properties.** An offer refers to a Version without being one of its properties.
`getItemPropertiesFromEas` and `getAttestationChangesSince` leave offers out, as they leave out bag
anchors (ADR 0029), so an offer changes no synced row, no Query record and no bag.

**Publishing.** `createPublish(item, address, wallet, { licenseOffer })` sends the offer with the
publish: through `multiPublish` as one more entry of the root request with a zero `refUID`; through
direct EAS in the transaction holding the root's property attestations, with the Version as `refUID`.
On a publish split across transactions (ADR 0036) the offer goes in the part that holds the root.

**Reading.** `getLicense({ seedUid, versionUid?, asOf? })` and `getLicenseHistory(seedUid)` in
`@seedprotocol/query` apply the rule. They read EAS on every call and keep no cache.

## Consequences

- What was published under an open license stays under it, without `revocable=false`.
- A license change governs content only once content is attested after it. An offer attested on its
  own, with no publish, governs nothing until the next publish. A publisher who opens a license on
  existing content republishes it with the offer.
- The EAS indexer lists attestations late. A client that reads the license in force before deciding
  whether to attest an offer can miss another client's offer made seconds earlier. Attesting again
  is safe: a second offer with the same `termsHash` changes nothing a reader sees.
- The schema has to be registered on each chain before an offer can be sent. A session key can't
  register it; any other wallet can, with `ensureLicenseOfferSchema`.
- `price`, `currency`, `payee`, `duration`, `max_grants`, `access_policy` and `gate_hook` have no
  meaning yet. Giving them one is L1 and L2 work, under this schema.

## Alternatives considered

- **Key the rule on the Version's attestation time:** text patched into a Version after a change to
  All rights reserved would read as still under the old open license.
- **An open offer on the Seed with `revocable=false`:** impossible through `multiPublish`, and it
  would forbid relicensing later versions.
- **Revocation removes the offer, so the previous one applies again:** an author who withdraws a
  license would silently reinstate an older one.
- **Attest catalog terms once per chain as `licenseTerms` and point offers at them:** attestation
  uids aren't deterministic, and catalog terms resolve offline from `termsHash`. `licenseTerms` is
  for terms outside the catalog, later.
