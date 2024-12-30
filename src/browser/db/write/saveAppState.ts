import { getAppDb } from '@/browser'
import { appState } from '@/shared/seedSchema'

export const saveAppState = async (key: string, value: string) => {
  const appDb = getAppDb()

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
