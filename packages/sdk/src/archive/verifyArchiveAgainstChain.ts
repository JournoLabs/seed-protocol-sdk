import { readBagInfo, verifyArchive, type ArchiveCheck, type ArchiveVerification, type Bag } from '@seedprotocol/archive'
import { ArchiveExportError, exportArchive, type ArchiveSeedRef, type ExportableItem } from './exportArchive'

export type ArchiveChainVerification = ArchiveVerification & {
  /** The bag against the one this device builds for the item from EAS. */
  rebuilt: ArchiveCheck
  /** With a failed `rebuilt`: the paths that differ or exist in only one of the two bags. */
  differingFiles: string[]
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.byteLength === b.byteLength && a.every((byte, index) => byte === b[index])

/**
 * Checks `bag` against its own manifests and against a fresh reproducible export of `item` at the
 * time the bag covers, so the hash it's compared with comes from EAS and not from the bag. `rebuilt`
 * is `not_checked` when the bag wasn't built to be reproduced, is for another seed, or the export is
 * refused; `detail` says which.
 */
export async function verifyArchiveAgainstChain(
  bag: Bag,
  item: ExportableItem | ArchiveSeedRef,
): Promise<ArchiveChainVerification> {
  const own = verifyArchive(bag)
  const notChecked = (detail: string): ArchiveChainVerification => ({
    ...own,
    rebuilt: { status: 'not_checked', detail },
    differingFiles: [],
  })

  const info = readBagInfo(bag)
  if (!info.has('Seed-Bag-Format')) return notChecked('The bag is not a reproducible bag')

  const asOf = Date.parse(info.get('Seed-Bag-As-Of') ?? '') / 1000
  if (!Number.isSafeInteger(asOf)) return notChecked('The bag does not say what time it covers')

  let rebuilt: Bag
  try {
    ;({ bag: rebuilt } = await exportArchive(item, { reproducible: true, asOf }))
  } catch (error) {
    if (error instanceof ArchiveExportError) return notChecked(`Export refused (${error.code}): ${error.message}`)
    throw error
  }
  const current = readBagInfo(rebuilt)
  for (const [label, name] of [['Seed-Uid', 'seed'], ['Seed-Version-Uid', 'Version']] as const) {
    if (info.get(label) !== current.get(label)) {
      return notChecked(`The bag is for ${name} ${info.get(label)}, and this item's is ${current.get(label)}`)
    }
  }
  if (info.get('Seed-Bag-Format') !== current.get('Seed-Bag-Format')) {
    return notChecked(`The bag uses format ${info.get('Seed-Bag-Format')}, and this SDK writes ${current.get('Seed-Bag-Format')}`)
  }

  const expected = verifyArchive(rebuilt).tagmanifestSha256
  const { anchor } = verifyArchive(bag, { expectedTagmanifestSha256: expected })
  const theirs = new Map(bag.files.map((f) => [f.path, f.bytes]))
  const ours = new Map(rebuilt.files.map((f) => [f.path, f.bytes]))
  const differingFiles = [...new Set([...theirs.keys(), ...ours.keys()])]
    .filter((path) => {
      const a = theirs.get(path)
      const b = ours.get(path)
      return !a || !b || !sameBytes(a, b)
    })
    .sort()
  return { ...own, rebuilt: anchor, differingFiles }
}
