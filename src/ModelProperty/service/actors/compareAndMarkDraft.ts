import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput } from '@/types'
import { ModelPropertyMachineContext } from '../modelPropertyMachine'
// Dynamic import to break circular dependency: helpers/db -> ModelProperty -> compareAndMarkDraft -> helpers/db
// import { savePropertyToDb } from '@/helpers/db'
import debug from 'debug'

const logger = debug('seedSdk:modelProperty:actors:compareAndMarkDraft')

export const compareAndMarkDraft = fromCallback<
  EventObject,
  FromCallbackInput<ModelPropertyMachineContext>
>(({ sendBack, input: { context } }) => {
  const _compareAndMarkDraft = async (): Promise<void> => {
    if (!context._originalValues) {
      // No original values to compare against
      logger('No original values to compare against')
      return
    }

    // Compare current values with original
    const hasChanges = Object.keys(context).some(key => {
      if (key.startsWith('_')) return false // Skip internal fields
      return context[key] !== context._originalValues?.[key]
    })

    if (hasChanges) {
      logger(`Property ${context.modelName}:${context.name} has changes, marking as edited`)

      // Use dynamic import to break circular dependency
      const { savePropertyToDb } = await import('@/helpers/db')
      
      // Save to database (but not JSON file) - always save to DB when there are changes
      await savePropertyToDb(context)

      // Mark schema as draft if schema name is available
      if (context._schemaName) {
        // Get the Schema instance and mark it as draft
        const { Schema } = await import('@/Schema/Schema')
        const schema = Schema.create(context._schemaName)

        // Send event to Schema machine to mark as draft
        schema.getService().send({
          type: 'markAsDraft',
          propertyKey: `${context.modelName}:${context.name}`,
        })
      }
    } else {
      // No changes - clear edited flag
      logger(`Property ${context.modelName}:${context.name} has no changes`)
      sendBack({
        type: 'clearEdited',
      })
    }
  }

  _compareAndMarkDraft().then(() => {
    sendBack({ type: 'compareAndMarkDraftSuccess' })
  }).catch((error) => {
    logger('Error comparing and marking draft:', error)
    sendBack({ type: 'compareAndMarkDraftError', error })
  })

  return () => {
    // Cleanup function (optional)
  }
})
