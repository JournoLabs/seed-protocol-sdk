import { dayjs } from '@/helpers/index'

type Log = (message: string, data?: unknown) => void

type LoggerType = (tag: string) => {
  log: Log
}

const tagsToLog = [
  // 'InternalMachine',
  'internal/actors',
  'db/actors',
]

const Logger: LoggerType = (tag: string) => {
  const _tag = tag || 'Logger'

  const log: Log = (message, data = undefined): void => {
    if (process.env.IS_SEED_DEV && tagsToLog.includes(_tag)) {
      const timestamp = dayjs().format('YYYY-MM-DD HH:mm:ss')
      console.log(
        `[${timestamp}] [${_tag}] ${dayjs().format('YYYY-MM-DD HH:mm:ss')} ${message}`,
        data || '',
      )
    }
  }

  return {
    log,
  }
}

export default Logger
