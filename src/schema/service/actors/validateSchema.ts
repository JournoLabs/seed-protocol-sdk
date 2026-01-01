import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput } from '@/types'
import { SchemaMachineContext } from '../schemaMachine'
import { SchemaValidationService } from '../validation/SchemaValidationService'

const validationService = new SchemaValidationService()

// Validation timeout in milliseconds (10 seconds)
const VALIDATION_TIMEOUT_MS = 10000

export const validateSchema = fromCallback<
  EventObject,
  FromCallbackInput<SchemaMachineContext>
>(({ sendBack, input: { context } }) => {
  let hasResponded = false
  
  // Timeout handler to ensure we always respond
  const timeoutId = setTimeout(() => {
    if (!hasResponded) {
      hasResponded = true
      sendBack({
        type: 'validationError',
        errors: [{
          field: 'schema',
          message: `Schema validation timed out after ${VALIDATION_TIMEOUT_MS}ms`,
          code: 'validation_timeout',
          severity: 'error' as const,
        }],
      })
    }
  }, VALIDATION_TIMEOUT_MS)

  // Run validation and ensure event is always sent back
  // Use Promise.resolve().then() to ensure async event sending
  // This prevents issues where synchronous validation might not trigger XState properly
  Promise.resolve().then(() => {
    try {
      const result = validationService.validateSchema(context)
      
      if (!hasResponded) {
        hasResponded = true
        clearTimeout(timeoutId)
        
        if (result.isValid) {
          sendBack({ type: 'validationSuccess', errors: [] })
        } else {
          sendBack({ type: 'validationError', errors: result.errors })
        }
      }
    } catch (error) {
      if (!hasResponded) {
        hasResponded = true
        clearTimeout(timeoutId)
        
        // Ensure error is always sent back
        sendBack({
          type: 'validationError',
          errors: [{
            field: 'schema',
            message: error instanceof Error ? error.message : 'Unknown validation error',
            code: 'validation_exception',
            severity: 'error' as const,
          }],
        })
      }
    }
  })

  return () => {
    // Cleanup function - clear timeout if actor is stopped
    clearTimeout(timeoutId)
  }
})

