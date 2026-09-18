import { app } from 'electron'
import { join } from 'path'
import { config, createLogger, format, transports } from 'winston'

const { combine, colorize, timestamp, label, printf } = format

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

const timestampFormatter = () => new Date().toLocaleString('en-US', { timeZone: timezone })

const autonomyLoggerFormat = printf(({ level, message, label, timestamp }) => {
  return `${timestamp as string} [${label as string}] ${level}: ${message as string}`
})

const logPath = join(app.getPath('userData'), 'logs')

const logger = createLogger({
  level: 'info',
  format: combine(label({ label: 'autonomy' }), timestamp({ format: timestampFormatter() }), autonomyLoggerFormat),
  transports: [
    new transports.File({ filename: join(logPath, 'error.log'), level: 'error' }),
    new transports.File({ filename: join(logPath, 'combined.log') }),
  ],
})

if (process.env.NODE_ENV !== 'production') {
  logger.add(
    new transports.Console({
      // EVERY level to stderr, not just the error ones.
      //
      // stdout is a DATA channel: the headless CLI promises exactly one JSON
      // document there, and `openplc-cli devices | jq` breaks the moment a log
      // line lands in the middle of it. Winston's default is the opposite of
      // what is wanted here — only the levels named in `stderrLevels` go to
      // stderr, everything else to stdout — which is how a container missing
      // arduino-cli and udevadm produced two coloured log lines wrapped around
      // otherwise valid JSON. Diagnostics belong on stderr on both surfaces;
      // the GUI's terminal shows them either way.
      stderrLevels: Object.keys(config.npm.levels),
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
