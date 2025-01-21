import { EventObject, fromCallback } from 'xstate'
import { INTERNAL_VALIDATING_INPUT_SUCCESS, ARWEAVE_HOST } from '@/services/internal/constants'
import { FromCallbackInput, InternalMachineContext } from '@/types'
import { isBrowser, isNode } from '@/helpers/environment'

export const validateInput = fromCallback<
  EventObject,
  FromCallbackInput<InternalMachineContext>
>(
  ({ sendBack, input: { context } }) => {

    const { endpoints, addresses, arweaveDomain } = context
    let { filesDir } = context

    if (!endpoints || !endpoints.filePaths || !endpoints.files) {
      throw new Error('validateInput called with invalid endpoints')
    }

    if (!addresses || !addresses.length) {
      throw new Error('validateInput called with invalid addresses')
    }

    if (!filesDir) {
      if (isBrowser()) {
        filesDir = '/'
      }

      if (!isBrowser()) {
        throw new Error('validateInput called with invalid filesDir')
      }
    }

    const _validateInput = async (): Promise<void> => {
      sendBack({
        type: INTERNAL_VALIDATING_INPUT_SUCCESS,
        endpoints,
        addresses,
        filesDir,
        arweaveDomain: arweaveDomain || ARWEAVE_HOST,
      })
    }

    _validateInput().then(() => {
      return
    })
  },
)
