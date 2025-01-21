import { EventObject, fromCallback } from 'xstate'
import {
  FromCallbackInput,
  GetSchemaForModelEvent,
  GlobalMachineContext,
} from '@/types'
import debug from 'debug'

const logger = debug('app:services:global:actors:getSchemaForModel')

export const getSchemaForModel = fromCallback<
  EventObject,
  FromCallbackInput<GlobalMachineContext, GetSchemaForModelEvent>
>(({ sendBack, input: { context, event } }) => {
  const { modelName } = event

  if (!modelName) {
    console.warn('No modelName found')
    return
  }

  const { models } = context

  if (!models) {
    console.warn('No models found')
    return
  }

  const model = Object.entries(models).find(
    ([modelNameFromConfig]) => modelNameFromConfig === modelName,
  )

  if (!model) {
    throw new Error(`Model ${modelName} not found`)
  }

  logger('[service/actor] [getSchemaForModel] model:', model)

  sendBack({ type: 'schemaForModel', schema: model.schema })

  return () => {}
})
