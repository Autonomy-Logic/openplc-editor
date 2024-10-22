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
  variable: string
}
