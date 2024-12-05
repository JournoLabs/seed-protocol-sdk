import dotenv from 'dotenv'

dotenv.config()

export const config = {
  waitforTimeout: 10000,
  connectionRetryTimeout: 90000,
  connectionRetryCount: 3,
}