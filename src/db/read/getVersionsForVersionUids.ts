import { runQueryForStatement } from '../sqlWasmClient'

type VersionData = {
  localId: string
  uid: string
  seedUid: string
  seedLocalId: string
}
type GetVersionsForVersionUids = (
  versionUids: string[],
) => Promise<VersionData[]>
export const getVersionsForVersionUids: GetVersionsForVersionUids = async (
  versionUids: string[],
) => {
  const queryStatement = `
      SELECT local_id, uid, seed_uid, seed_local_id
      FROM versions
      WHERE uid IN ('${versionUids.join("','")}');
  `

  const { rows } = await runQueryForStatement(queryStatement)

  if (!rows || rows.length === 0) {
    return []
  }

  const versionsData: VersionData[] = []

  for (const row of rows) {
    versionsData.push({
      localId: row[0],
      uid: row[1],
      seedUid: row[2],
      seedLocalId: row[3],
    })
  }

  return versionsData
}
