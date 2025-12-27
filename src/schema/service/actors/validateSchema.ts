import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput } from '@/types'
import { SchemaMachineContext } from '../schemaMachine'
import { SchemaValidationService } from '../validation/SchemaValidationService'

const validationService = new SchemaValidationService()

export const validateSchema = fromCallback<
  EventObject,
  FromCallbackInput<SchemaMachineContext>
>(({ sendBack, input: { context } }) => {
  const _validateSchema = async (): Promise<void> => {
    const result = validationService.validateSchema(context)
    
    if (result.isValid) {
      sendBack({ type: 'validationSuccess', errors: [] })
    } else {
      sendBack({ type: 'validationError', errors: result.errors })
    }
  }

  _validateSchema().catch((error) => {
    sendBack({
      type: 'validationError',
      errors: [{
        field: 'schema',
        message: error instanceof Error ? error.message : 'Unknown validation error',
        code: 'validation_exception',
        severity: 'error' as const,
      }],
    })
  })

  return () => {
    // Cleanup function (optional)
  }
})

