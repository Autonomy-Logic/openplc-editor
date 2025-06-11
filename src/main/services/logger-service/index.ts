import { app } from 'electron'
import { join } from 'path'
import { createLogger, format, transports } from 'winston'

const { combine, colorize, timestamp, label, printf } = format

const timestampFormat = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })

const autonomyLoggerFormat = printf(({ level, message, label, timestamp }) => {
  return `${timestamp as string} [${label as string}] ${level}: ${message as string}`
})

const logPath = app.getPath('userData')

const logger = createLogger({
  level: 'info',
  format: combine(label({ label: 'autonomy' }), timestamp({ format: timestampFormat }), autonomyLoggerFormat),
  transports: [
    new transports.File({ filename: join(logPath, 'error.log'), level: 'error' }),
    new transports.File({ filename: join(logPath, 'combined.log') }),
    new transports.File({
      filename: join(logPath, 'debug.log'),
      format: combine(label({ label: 'app-debug' }), timestamp({ format: timestampFormat }), autonomyLoggerFormat),
      level: 'debug',
    }),
  ],
})

if (process.env.NODE_ENV !== 'production') {
  logger.add(
    new transports.Console({
      format: combine(
        colorize(),
        printf(({ level, message }) => {
          return `${level}: ${message as string}`
        }),
      ),
    }),
  )
}

export { logger }
