import { useState } from 'react'
import { useSelector }         from '@xstate/react'
import { getGlobalService } from '@/services/global/globalMachine'
import { ModelClassType } from '@/types'

export const useModels = () => {

  const [_models, setModels] = useState<{ [key: string]: ModelClassType } | undefined>()

  const globalService = getGlobalService()

  const models = useSelector(globalService, (snapshot) => {
    if (snapshot && snapshot.context && snapshot.context.models) {
      return snapshot.context.models
    }
    return
  })

  return {
    models,
  }
}
