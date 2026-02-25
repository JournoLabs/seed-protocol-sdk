import { assign } from "xstate";
import { saveAppState } from "../actors/saveAppState";

export const setAddresses = assign(({event, spawn}) => {
  const { addresses } = event
  spawn(saveAppState, {
    input: {
      key: 'addresses',
      value: addresses,
    },
  })
  return {
    addresses,
    isSaving: true,
  }
})
