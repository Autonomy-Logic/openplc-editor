import { PLCVariableSchema } from '@root/types/PLC'
import { PLCDataTypeSchema, PLCInstanceSchema, PLCTaskSchema } from '@root/types/PLC/open-plc'
import { z } from 'zod'

import { zodFBDFlowSchema } from '../fbd'
import { zodLadderFlowSchema } from '../ladder'

const historySnapshotSchema = z.object({
  variables: z.array(PLCVariableSchema),
  body: z.any(),
  ladderFlow: zodLadderFlowSchema.optional(),
  fbdFlow: zodFBDFlowSchema.optional(),
  globalVariables: z.array(PLCVariableSchema).optional(),
  tasks: z.array(PLCTaskSchema).optional(),
  instances: z.array(PLCInstanceSchema).optional(),
  dataTypes: z.array(PLCDataTypeSchema).optional(),
})

type HistorySnapshot = z.infer<typeof historySnapshotSchema>

const historyStateSchema = z
  .record(
    z.string(),
    z.object({
      past: z.array(historySnapshotSchema).default([]),
      future: z.array(historySnapshotSchema).default([]),
    }),
  )
  .default({})

type HistoryState = z.infer<typeof historyStateSchema>

const historyActionsSchema = z.object({
  addPastHistory: z.function().args(z.string(), historySnapshotSchema).returns(z.void()),
  addFutureHistory: z.function().args(z.string(), historySnapshotSchema).returns(z.void()),
  popPastHistory: z.function().args(z.string()).returns(historySnapshotSchema.optional()),
  popFutureHistory: z.function().args(z.string()).returns(historySnapshotSchema.optional()),
  undo: z.function().args(z.string()).returns(z.void()),
  redo: z.function().args(z.string()).returns(z.void()),
  clearHistory: z.function().returns(z.void()),
})

type HistoryActions = z.infer<typeof historyActionsSchema>

type HistorySlice = {
  history: HistoryState
  historyActions: HistoryActions
}

export { historyActionsSchema, historySnapshotSchema, historyStateSchema }
export type { HistoryActions, HistorySlice, HistorySnapshot, HistoryState }
