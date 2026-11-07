import type { SeedLicenseTerms } from '../../src'

const ccBy: SeedLicenseTerms = {
  profile: 'https://seedprotocol.io/odrl/seed-license/1',
  spdx: 'CC-BY-4.0',
  legal: { sha256: 'a'.repeat(64), lang: 'en', canonicalUrl: 'https://creativecommons.org/licenses/by/4.0/legalcode.en' },
  permissions: [
    { action: 'reproduce' },
    { action: 'distribute' },
    { action: 'derive' },
    { action: 'distribute', target: 'adaptation' },
    { action: 'commercialize' },
  ],
  prohibitions: [],
  duties: [{ duty: 'attribute' }, { duty: 'includeNotice' }],
  grant: {
    transferable: false,
    sublicensable: false,
    exclusive: false,
    revocableFor: 'breach-only',
    warranty: 'as-is',
    duration: 'copyright-term',
  },
}

const with_ = (patch: Record<string, unknown>) => ({ ...ccBy, ...patch })

export const validTerms = {
  ccBy,
  withTransition: { ...ccBy, transition: { changeAt: { afterSeconds: 63072000 }, changeLicense: 'Apache-2.0' } },
  withConstraints: {
    ...ccBy,
    permissions: [
      { action: 'reproduce', constraints: [{ name: 'spatial', operator: 'eq', value: 'DE' }] },
      { action: 'seed:aiInput', constraints: [{ name: 'userClass', operator: 'eq', value: 'education' }] },
    ],
  },
  undefinedOptional: { ...ccBy, transition: undefined, governingLaw: undefined },
} satisfies Record<string, SeedLicenseTerms>

export const invalidTerms = {
  extraKey: with_({ colour: 'blue' }),
  unknownAction: with_({ permissions: [{ action: 'print' }] }),
  badSpdx: with_({ spdx: 'NOT-A-LICENSE' }),
  floatNumber: with_({ grant: { ...ccBy.grant, duration: 1.5 } }),
  upperHex: with_({ legal: { ...ccBy.legal, sha256: 'A'.repeat(64) } }),
  prefixedHex: with_({ legal: { ...ccBy.legal, sha256: '0x' + 'a'.repeat(62) } }),
  permittedAndProhibited: with_({ prohibitions: [{ action: 'commercialize' }] }),
  shareAlikeWithoutDerive: with_({ permissions: [{ action: 'reproduce' }], duties: [{ duty: 'shareAlike' }] }),
  transitionBothTimes: with_({ transition: { changeAt: { afterSeconds: 1, at: 2 }, changeLicense: 'MIT' } }),
  transitionNeitherTime: with_({ transition: { changeAt: {}, changeLicense: 'MIT' } }),
  badChangeLicense: with_({ transition: { changeAt: { at: 2 }, changeLicense: 'NOPE' } }),
  wrongProfile: with_({ profile: 'https://example.com/profile' }),
  exclusiveTrue: with_({ grant: { ...ccBy.grant, exclusive: true } }),
  badConstraint: with_({ permissions: [{ action: 'reproduce', constraints: [{ name: 'dateTime', operator: 'eq', value: 1 }] }] }),
  missingLegal: (() => {
    const { legal: _legal, ...rest } = ccBy
    return rest
  })(),
  inheritedDuty: with_({ duties: [{ duty: 'toString' }] }),
  inheritedDutyWithKey: with_({ duties: [{ duty: 'toString', x: 1 }] }),
  inheritedConstraint: with_({ permissions: [{ action: 'reproduce', constraints: [{ name: 'constructor', operator: 'eq', value: 1 }] }] }),
  sparsePermissions: with_({ permissions: new Array(3) }),
  null: null,
  array: [],
  string: 'x',
  number: 1,
} satisfies Record<string, unknown>

