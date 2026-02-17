import { BaseDb } from '@/db/Db/BaseDb'
import { appState } from '@/seedSchema'

export const saveAppState = async (key: string, value: string) => {
  const appDb = BaseDb.getAppDb()

  await appDb
    .insert(appState)
    .values({
      key,
      value,
    })
    .onConflictDoUpdate({
      target: appState.key,
      set: {
        value,
      },
    })
}
