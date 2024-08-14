import { CustomHandleProps } from "../handle"

export type BuilderBasicProps = {
  id: string
  posX: number
  posY: number
  handleX: number
  handleY: number
}

export type BasicNodeData = {
  handles: CustomHandleProps[]
  nodeInputHandle: CustomHandleProps | undefined
  nodeOutputHandle: CustomHandleProps | undefined
}
