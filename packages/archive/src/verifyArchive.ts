import { getBagFile, type Bag } from './bag'
import { digestHex, fromUtf8 } from './bytes'
import { parseTagLines, validateBag } from './validateBag'

/**
 * Checks a bag without Seed code or a network. Each check is reported on its own, with no overall
 * verdict: a bag's own checksums show it is intact, not whose it is, so a reader has to see which
 * checks actually ran.
 */

export type ArchiveCheck = {
  status: 'passed' | 'failed' | 'not_checked'
  detail: string
}

export type ArchiveVerification = {
  /** SHA-256 of tagmanifest-sha256.txt, the hash that commits to every file. */
  tagmanifestSha256?: string
  /** The bag against its own manifests. */
  fixity: ArchiveCheck & { errors: string[] }
  /** The bag against `expectedTagmanifestSha256`. */
  anchor: ArchiveCheck
}

export type VerifyArchiveOptions = {
  /** The tagmanifest hash from a source outside the bag, as hex with or without `0x`. */
  expectedTagmanifestSha256?: string
}

/** bag-info.txt's labels and values, the first value for a repeated label. */
export function readBagInfo(bag: Bag): Map<string, string> {
  const file = getBagFile(bag, 'bag-info.txt')
  const text = file ? fromUtf8(file.bytes) : undefined
  return new Map(parseTagLines(text ?? '').reverse())
}

/**
 * Checks `bag` against its own manifests and, given `expectedTagmanifestSha256`, against that hash.
 * Anyone who changes a file can rewrite the manifests too, so only the second check shows the bag
 * is the one the hash was taken from.
 */
export function verifyArchive(bag: Bag, options: VerifyArchiveOptions = {}): ArchiveVerification {
  const tagmanifest = getBagFile(bag, 'tagmanifest-sha256.txt')
  const tagmanifestSha256 = tagmanifest ? digestHex('sha256', tagmanifest.bytes) : undefined

  const { errors } = validateBag(bag)
  const fixityErrors = tagmanifest ? errors : [...errors, 'tagmanifest-sha256.txt is missing']
  const fixity: ArchiveVerification['fixity'] =
    fixityErrors.length === 0
      ? { status: 'passed', detail: 'Every file matches the bag\'s own manifests', errors: fixityErrors }
      : { status: 'failed', detail: `${fixityErrors.length} problem(s) against the bag's own manifests`, errors: fixityErrors }

  const expected = options.expectedTagmanifestSha256?.toLowerCase().replace(/^0x/, '')
  const anchor: ArchiveCheck =
    expected === undefined
      ? { status: 'not_checked', detail: 'No hash from outside the bag to compare with' }
      : expected === tagmanifestSha256
        ? { status: 'passed', detail: 'The tag manifest matches the expected hash' }
        : { status: 'failed', detail: `The tag manifest hash is ${tagmanifestSha256 ?? 'missing'}, expected ${expected}` }

  return { tagmanifestSha256, fixity, anchor }
}

export type VerifyInstructions = {
  seedUid: string
  versionUid: string
  /** The Version's attestation on an explorer. */
  explorerUrl?: string
  /** The bag was built to be rebuilt by any client. */
  reproducible: boolean
}

/** VERIFY.txt: how to check the bag by hand. */
export function verifyInstructions({ seedUid, versionUid, explorerUrl, reproducible }: VerifyInstructions): string {
  const rebuild = reproducible
    ? [
        '',
        'This bag is reproducible: exportArchive(item, { reproducible: true }) on a client with this',
        'Version synced gives the same tagmanifest-sha256.txt. Compare its SHA-256 with this bag\'s:',
        '',
        '  shasum -a 256 tagmanifest-sha256.txt',
      ]
    : []
  return [
    'To check every file against this bag\'s manifests, with no network, run in this directory:',
    '',
    '  shasum -a 256 -c tagmanifest-sha256.txt',
    '  shasum -a 256 -c manifest-sha256.txt',
    '',
    'Passing shows the bag is intact. It doesn\'t show who made it, because anyone who changes a file',
    'can rewrite the manifests too.',
    ...rebuild,
    '',
    `Seed: ${seedUid}`,
    `Version: ${versionUid}`,
    ...(explorerUrl ? [`Attestation: ${explorerUrl}`] : []),
    '',
  ].join('\n')
}
