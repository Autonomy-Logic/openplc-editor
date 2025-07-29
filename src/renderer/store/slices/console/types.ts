import { z } from 'zod'

const logObjectSchema = z.object({
  id: z.string(),
  level: z.enum(['info', 'warning', 'error']).optional(),
  message: z.string(),
})

const consoleStateSchema = z.object({
  logs: z.array(logObjectSchema),
})

type ConsoleState = z.infer<typeof consoleStateSchema>

const consoleActionSchema = z.object({
  addLog: z.function().args(logObjectSchema).returns(z.void()),
  removeLog: z.function().args(z.string()).returns(z.void()),
  clearLogs: z.function().returns(z.void()),
})

type ConsoleActions = z.infer<typeof consoleActionSchema>

type ConsoleSlice = ConsoleState & {
  consoleActions: ConsoleActions
}

export { consoleActionSchema, consoleStateSchema, logObjectSchema }

export type { ConsoleActions, ConsoleSlice, ConsoleState }
