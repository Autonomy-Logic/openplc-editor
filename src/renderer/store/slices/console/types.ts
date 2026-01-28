import { z } from 'zod'

const logObjectSchema = z.object({
  id: z.string(),
  level: z.enum(['debug', 'info', 'warning', 'error']).optional(),
  message: z.string(),
  tstamp: z.coerce
    .date()
    .optional()
    .default(() => new Date()),
})

const timestampFormatSchema = z.enum(['full', 'time', 'none'])

const consoleFiltersSchema = z.object({
  levels: z.object({
    debug: z.boolean(),
    info: z.boolean(),
    warning: z.boolean(),
    error: z.boolean(),
  }),
  searchTerm: z.string(),
  timestampFormat: timestampFormatSchema,
})

type TimestampFormat = z.infer<typeof timestampFormatSchema>

const consoleStateSchema = z.object({
  logs: z.array(logObjectSchema),
  filters: consoleFiltersSchema,
})

type ConsoleState = z.infer<typeof consoleStateSchema>

const consoleActionSchema = z.object({
  addLog: z.function().args(logObjectSchema).returns(z.void()),
  removeLog: z.function().args(z.string()).returns(z.void()),
  clearLogs: z.function().returns(z.void()),
  setLevelFilter: z
    .function()
    .args(z.enum(['debug', 'info', 'warning', 'error']), z.boolean())
    .returns(z.void()),
  setSearchTerm: z.function().args(z.string()).returns(z.void()),
  setTimestampFormat: z.function().args(timestampFormatSchema).returns(z.void()),
})

type ConsoleActions = z.infer<typeof consoleActionSchema>

type ConsoleSlice = ConsoleState & {
  consoleActions: ConsoleActions
}

export { consoleActionSchema, consoleFiltersSchema, consoleStateSchema, logObjectSchema, timestampFormatSchema }

export type { ConsoleActions, ConsoleSlice, ConsoleState, TimestampFormat }
