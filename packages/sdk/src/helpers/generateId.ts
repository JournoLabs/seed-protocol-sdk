import { customAlphabet } from 'nanoid'
import { alphanumeric } from 'nanoid-dictionary'

export const generateId = (): string => {
  return customAlphabet(alphanumeric, 10)()
}
