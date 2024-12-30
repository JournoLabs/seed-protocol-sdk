import { EventObject, fromCallback } from 'xstate'
import { INTERNAL_VALIDATING_INPUT_SUCCESS } from '@/services/internal/constants'
import { internalMachine } from '@/services/internal/internalMachine'

export const validateInput = fromCallback<EventObject, typeof internalMachine>(
  ({ sendBack, input: { event } }) => {
    const { endpoints, addresses } = event

    if (typeof window === 'undefined') {
      throw new Error('validateInput called from non-browser context')
    }

    if (!endpoints || !endpoints.filePaths || !endpoints.files) {
      throw new Error('validateInput called with invalid endpoints')
    }

    if (!addresses || !addresses.length) {
      throw new Error('validateInput called with invalid addresses')
    }

    const _validateInput = async (): Promise<void> => {
      sendBack({
        type: INTERNAL_VALIDATING_INPUT_SUCCESS,
        endpoints,
        addresses,
      })
    }

    _validateInput().then(() => {
      return
    })
  },
)
