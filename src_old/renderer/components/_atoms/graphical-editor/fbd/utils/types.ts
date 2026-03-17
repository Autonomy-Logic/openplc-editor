import { PLCVariable } from '@root/types/PLC/open-plc'
import { XYPosition } from '@xyflow/react'

import { CustomHandleProps } from '../handle'

export type BuilderBasicProps = {
  id: string
  position: XYPosition
}

export type BasicNodeData = {
  handles: CustomHandleProps[]
  inputHandles: CustomHandleProps[]
  outputHandles: CustomHandleProps[]
  inputConnector: CustomHandleProps | undefined
  outputConnector: CustomHandleProps | undefined
  numericId: string
  executionOrder: number
  variable: { id?: string; name: string } | PLCVariable
  draggable: boolean
  selectable: boolean
  deletable: boolean
}
