import * as sha3 from 'js-sha3'

const { sha3_256, } = sha3


export const getContentHash = async (
  data: sha3.Message
): Promise<string> => {
  return sha3_256(data)
}