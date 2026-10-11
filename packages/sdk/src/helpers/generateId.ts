import { customAlphabet } from 'nanoid'
import { alphanumeric } from 'nanoid-dictionary'

const randomId = customAlphabet(alphanumeric, 10)

/**
 * A 10-character local id. Never starts with "0x" (about 1 in 3,844 random ids would), so code that
 * tells local ids from EAS uids by that prefix can't mistake one for the other.
 */
export const generateId = (): string => {
  let id = randomId()
  while (id.startsWith('0x')) id = randomId()
  return id
}
