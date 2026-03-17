import { PLCVariable } from '@root/types/PLC/open-plc'
import type { VariableReference } from '@root/types/PLC/variable-reference'

import { CustomHandleProps } from '../handle'

export type BuilderBasicProps = {
  id: string
  posX: number
  posY: number
  handleX: number
  handleY: number
}

export type BasicNodeData = {
  handles: CustomHandleProps[]
  inputHandles: CustomHandleProps[]
  outputHandles: CustomHandleProps[]
  inputConnector: CustomHandleProps | undefined
  outputConnector: CustomHandleProps | undefined
  numericId: string
  variable: { id?: string; name: string } | PLCVariable
  variableRef?: VariableReference
  executionOrder: number
  draggable: boolean
  selectable: boolean
  deletable: boolean
}
